/**
 * IR phase 7 — analyse-units (one LLM call per unit). Walks every {@link IrUnitSourceRecord}
 * persisted by Phase 6 and produces an {@link IrUnitAnalysisRecord} per unit. The resolution
 * context (imports + sibling signatures) is reconstructed from the unit's parent file-analysis
 * record (small file) or analysed-chunk record (big file). Re-runs skip units whose analysis
 * record already exists on disk.
 *
 * Honors `LlmConcurrency`; LLM-config failures bubble up so the pipeline fails fast.
 */
import { type AskLlmOptions } from "@bb/llm";
import { LlmConfigError } from "@bb/errors";
import { logger } from "@bb/logger";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import { runInPool } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled, CancellationError } from "#src/pipeline/cancellation.ts";
import { readScanManifest } from "#src/strategies/flat-folder/scan-manifest.ts";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { extractUnit } from "#src/strategies/intermediate-representation/unit-analysis/extract-unit.ts";
import { buildResolutionContext } from "#src/strategies/intermediate-representation/unit-analysis/resolution-context.ts";
import type {
  IrFileAnalysisRecord,
} from "#src/strategies/intermediate-representation/records.ts";
import type {
  IrUnitAnalysisRecord,
  IrUnitSourceRecord,
} from "#src/strategies/intermediate-representation/types.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import {
  hasFileAnalysisRecord,
  hasUnitAnalysisRecord,
  listRawChunkNumbers,
  readAnalysedChunkIfPresent,
  readFileAnalysisRecordIfPresent,
  readUnitSourceRecordIfPresent,
  saveUnitAnalysisRecord,
} from "#src/strategies/intermediate-representation/storage.ts";
import { buildUnitFileId } from "#src/strategies/intermediate-representation/file-analysis/unit-id.ts";

export interface AnalyseUnitsInput {
  knowledgeId: string;
  metaPaths: MetaPaths;
  /** Max number of units analysed in parallel (across all parents). */
  concurrency: number;
  llmCallContext?: AskLlmOptions;
  progressContext?: ProgressContext;
}

export interface AnalyseUnitsResult {
  analysed: number;
  cached: number;
  failed: number;
  tokenUsage: TokenUsage;
}

interface PendingUnit {
  relativePath: string;
  chunkNumber: number | null;
  parent: IrFileAnalysisRecord;
  source: IrUnitSourceRecord;
}

function descriptorOf(source: IrUnitSourceRecord): UnitDescriptor {
  return {
    unitId: source.unitId,
    unitKind: source.unitKind,
    name: source.name,
    qualifiedName: source.qualifiedName,
    parentUnitId: source.parentUnitId,
    startLine: source.startLine,
    endLine: source.endLine,
    isBehavioral: source.isBehavioral,
    source: source.source,
  };
}

export async function analyseUnits(input: AnalyseUnitsInput): Promise<AnalyseUnitsResult> {
  const manifest = await readScanManifest(input.metaPaths);
  if (manifest === null) {
    throw new Error(`ir/analyse-units: scan manifest missing at ${input.metaPaths.scanManifestJson}`);
  }

  // Build the per-unit work list by walking every parent file-analysis record on disk and
  // pairing each parent's descriptors with their corresponding source records (from Phase 6).
  const work: PendingUnit[] = [];
  for (const entry of manifest.entries) {
    throwIfCancelled(input.knowledgeId);
    if (entry.kind === "small") {
      if (!(await hasFileAnalysisRecord(input.metaPaths, entry.relativePath))) {
        continue;
      }
      const parent = await readFileAnalysisRecordIfPresent(input.metaPaths, entry.relativePath);
      if (parent === null) {
        continue;
      }
      for (const descriptor of parent.analysis.units) {
        // Phase 6 saves the unit source under `<unitFileId>/codeUnits/…` where
        // unitFileId = `${parentRelPath}__${qualifiedName}`. Read it back with the same key.
        const unitFileId = buildUnitFileId(entry.relativePath, descriptor.qualifiedName);
        const source = await readUnitSourceRecordIfPresent(
          input.metaPaths,
          unitFileId,
          null,
          descriptor.qualifiedName,
        );
        if (source !== null) {
          work.push({ relativePath: entry.relativePath, chunkNumber: null, parent, source });
        }
      }
      continue;
    }
    const numbers = await listRawChunkNumbers(input.metaPaths, entry.relativePath);
    for (const chunkNumber of numbers) {
      const parent = await readAnalysedChunkIfPresent(input.metaPaths, entry.relativePath, chunkNumber);
      if (parent === null) {
        continue;
      }
      for (const descriptor of parent.analysis.units) {
        // Chunk file node id matches analyse-big-chunks: `${relativePath}:chunk-N`.
        const chunkFileNodeId = `${entry.relativePath}:chunk-${String(chunkNumber)}`;
        const unitFileId = buildUnitFileId(chunkFileNodeId, descriptor.qualifiedName);
        const source = await readUnitSourceRecordIfPresent(
          input.metaPaths,
          unitFileId,
          chunkNumber,
          descriptor.qualifiedName,
        );
        if (source !== null) {
          work.push({ relativePath: entry.relativePath, chunkNumber, parent, source });
        }
      }
    }
  }

  let analysed = 0;
  let cached = 0;
  let failed = 0;
  let totalUsage: TokenUsage = ZERO_USAGE;

  const reporter = input.progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "ir_analyse_units",
    total: { kind: "fixed", total: work.length },
  });
  await reporter?.start();

  try {
    await runInPool(input.concurrency, work, async ({ relativePath, chunkNumber, parent, source }) => {
      throwIfCancelled(input.knowledgeId);
      const chunkLabel = chunkNumber === null ? "" : `#chunk-${String(chunkNumber)}`;
      const tag = `${relativePath}${chunkLabel}::${source.qualifiedName}`;
      try {
        if (
          // Cache key mirrors the save side: analysis record lives under source.fileId (the
          // unitFileId), NOT the parent file's relativePath. Using relativePath here would
          // make the check miss every existing record.
          await hasUnitAnalysisRecord(input.metaPaths, source.fileId, chunkNumber, source.qualifiedName)
        ) {
          cached += 1;
          reporter?.increment(1, { fileName: tag });
          return;
        }
        const context = buildResolutionContext(parent.analysis.module, parent.analysis.units);
        const callInput: Parameters<typeof extractUnit>[0] = {
          descriptor: descriptorOf(source),
          fileId: source.fileId,
          language: source.language,
          relativePath,
          context,
        };
        if (input.llmCallContext !== undefined) {
          callInput.llmCallContext = input.llmCallContext;
        }
        const result = await extractUnit(callInput);
        const analysisRecord: IrUnitAnalysisRecord = {
          relativePath: source.fileId,
          chunkNumber,
          fileId: source.fileId,
          unitId: source.unitId,
          qualifiedName: source.qualifiedName,
          codeUnit: result.codeUnit,
          attempts: result.attempts,
          tokenUsage: result.tokenUsage,
          model: result.model,
          analysedAt: new Date().toISOString(),
        };
        await saveUnitAnalysisRecord(input.metaPaths, analysisRecord);
        analysed += 1;
        totalUsage = addUsage(totalUsage, result.tokenUsage);
        reporter?.increment(1, {
          fileName: tag,
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          costUsd: result.tokenUsage.costUsd,
          model: result.model,
        });
      } catch (cause: unknown) {
        if (cause instanceof CancellationError) {
          throw cause;
        }
        if (cause instanceof LlmConfigError) {
          throw cause;
        }
        failed += 1;
        const msg = cause instanceof Error ? cause.message : String(cause);
        logger.warn(`ir/analyse-units: ${tag} failed: ${msg}`);
        reporter?.increment(1, { fileName: tag });
      }
    }, { onActiveChange: (n) => reporter?.setActive?.(n) });
  } finally {
    reporter?.stop();
  }

  logger.info(
    `ir/analyse-units done: analysed=${analysed} cached=${cached} failed=${failed} totalUnits=${work.length}`,
  );
  return { analysed, cached, failed, tokenUsage: totalUsage };
}
