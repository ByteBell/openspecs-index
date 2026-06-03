/**
 * IR phase 6 — extract-unit-sources (PURE, no LLM). For every {@link IrFileAnalysisRecord} on
 * disk (small files AND big-file chunks), re-project each {@link UnitDescriptor} onto its own
 * `<safeUnit>.source.json` file under `<fileDir>/codeUnits/` (small file) or
 * `<bigFileDir>/chunks/chunk-N/codeUnits/` (big-file chunk). Phase 6 does NOT
 * re-read the original file — the descriptor's `source` slice was populated at file-analysis
 * time, so this phase only computes sha256/sizeBytes/tokenCount and persists.
 *
 * Re-runs skip units whose source record already exists on disk (presence-only check).
 */
import { createHash } from "node:crypto";
import { tokenLen } from "@bb/llm";
import { logger } from "@bb/logger";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import { runInPool } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import { readScanManifest } from "#src/strategies/flat-folder/scan-manifest.ts";
import type {
  IrFileAnalysisRecord,
} from "#src/strategies/intermediate-representation/records.ts";
import type { IrUnitSourceRecord } from "#src/strategies/intermediate-representation/types.ts";
import {
  hasFileAnalysisRecord,
  hasUnitSourceRecord,
  listRawChunkNumbers,
  readAnalysedChunkIfPresent,
  readFileAnalysisRecordIfPresent,
  saveUnitSourceRecord,
} from "#src/strategies/intermediate-representation/storage.ts";
import { unitFileIdOf } from "#src/strategies/intermediate-representation/file-analysis/unit-id.ts";

export interface ExtractUnitSourcesInput {
  knowledgeId: string;
  metaPaths: MetaPaths;
  /** Max parallelism for the (pure) projection. Each task projects one parent record. */
  concurrency: number;
  progressContext?: ProgressContext;
}

export interface ExtractUnitSourcesResult {
  extracted: number;
  cached: number;
  failed: number;
}

interface PendingParent {
  relativePath: string;
  chunkNumber: number | null;
  record: IrFileAnalysisRecord;
}

export async function extractUnitSources(input: ExtractUnitSourcesInput): Promise<ExtractUnitSourcesResult> {
  const manifest = await readScanManifest(input.metaPaths);
  if (manifest === null) {
    throw new Error(`ir/extract-unit-sources: scan manifest missing at ${input.metaPaths.scanManifestJson}`);
  }

  // Build the parent work list: one entry per file-analysis record on disk (small files +
  // big-file chunks). Each entry carries the parsed record so the worker has the descriptors.
  const parents: PendingParent[] = [];
  for (const entry of manifest.entries) {
    throwIfCancelled(input.knowledgeId);
    if (entry.kind === "small") {
      if (!(await hasFileAnalysisRecord(input.metaPaths, entry.relativePath))) {
        continue;
      }
      const record = await readFileAnalysisRecordIfPresent(input.metaPaths, entry.relativePath);
      if (record !== null) {
        parents.push({ relativePath: entry.relativePath, chunkNumber: null, record });
      }
      continue;
    }
    // big file: enumerate every analysed chunk currently on disk
    const numbers = await listRawChunkNumbers(input.metaPaths, entry.relativePath);
    for (const chunkNumber of numbers) {
      const record = await readAnalysedChunkIfPresent(input.metaPaths, entry.relativePath, chunkNumber);
      if (record !== null) {
        parents.push({ relativePath: entry.relativePath, chunkNumber, record });
      }
    }
  }

  let extracted = 0;
  let cached = 0;
  let failed = 0;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "ir_extract_unit_sources",
    total: { kind: "fixed", total: parents.length },
  });
  await reporter?.start();

  try {
    await runInPool(input.concurrency, parents, async ({ relativePath, chunkNumber, record }) => {
      throwIfCancelled(input.knowledgeId);
      const tag = chunkNumber === null ? relativePath : `${relativePath}#chunk-${String(chunkNumber)}`;
      try {
        for (const descriptor of record.analysis.units) {
          if (
            await hasUnitSourceRecord(input.metaPaths, relativePath, chunkNumber, descriptor.qualifiedName)
          ) {
            cached += 1;
            continue;
          }
          const source = descriptor.source;
          const unitFileId = unitFileIdOf(descriptor.unitId);
          const unitRecord: IrUnitSourceRecord = {
            relativePath: unitFileId,
            chunkNumber,
            fileId: unitFileId,
            language: record.language,
            unitId: descriptor.unitId,
            unitKind: descriptor.unitKind,
            name: descriptor.name,
            qualifiedName: descriptor.qualifiedName,
            parentUnitId: descriptor.parentUnitId,
            startLine: descriptor.startLine,
            endLine: descriptor.endLine,
            isBehavioral: descriptor.isBehavioral,
            source,
            sha256: createHash("sha256").update(source).digest("hex"),
            sizeBytes: Buffer.byteLength(source, "utf8"),
            tokenCount: tokenLen(source),
            extractedAt: new Date().toISOString(),
          };
          await saveUnitSourceRecord(input.metaPaths, unitRecord);
          extracted += 1;
        }
        reporter?.increment(1, { fileName: tag });
      } catch (cause: unknown) {
        if (cause instanceof CancellationError) {
          throw cause;
        }
        failed += 1;
        const msg = cause instanceof Error ? cause.message : String(cause);
        logger.warn(`ir/extract-unit-sources: ${tag} failed: ${msg}`);
        reporter?.increment(1, { fileName: tag });
      }
    });
  } finally {
    reporter?.stop();
  }

  logger.info(
    `ir/extract-unit-sources done: extracted=${extracted} cached=${cached} failed=${failed} parents=${parents.length}`,
  );
  return { extracted, cached, failed };
}
