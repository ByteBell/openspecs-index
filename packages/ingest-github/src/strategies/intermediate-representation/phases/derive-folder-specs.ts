/**
 * IR phase 8 — derive-folder-specs (PURE, no LLM).
 *
 * Walks every file-analysis record on disk, groups by parent folder, and for each folder
 * with at least `MIN_FOLDER_SIZE` direct-child files emits a `FolderSpecRecord` capturing
 * the consensus on five inheritable fields: representation family, representation type,
 * concurrency model, reconstruction hints, language.
 *
 * Aggregation rule per field: mode (most-common value) across the folder's files. The folder
 * publishes a value only when the mode is NOT the field's parser-default AND at least
 * `AGREEMENT_THRESHOLD` of the files agree. Compound fields (concurrency, reconstruction
 * hints) aggregate per-subfield so one outlier doesn't block the rest.
 *
 * Per-file records are never mutated. The FolderSpec is a parallel artifact; downstream
 * consumers that want inheritance read both folder + file together.
 *
 * Scope: small-file analyses only. Big-file chunked records are skipped because one big file
 * carries N chunk-level IRs, not one file-level IR; folding chunks into a single
 * "representative" would paper over real differences.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "@bb/logger";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import { decodeMetaPath } from "#src/pipeline/paths.ts";
import { readFileAnalysisRecordIfPresent } from "#src/strategies/intermediate-representation/storage.ts";
import type { IrFileAnalysisRecord } from "#src/strategies/intermediate-representation/records.ts";
import type { ConcurrencyModel } from "#src/strategies/intermediate-representation/file-analysis/types/v2/orchestration.ts";
import type { ReconstructionHints } from "#src/strategies/intermediate-representation/file-analysis/types/v2/shape.ts";
import type { RepresentationFamily } from "#src/strategies/intermediate-representation/file-analysis/types/v2/substrate.ts";
import type { ModuleIr } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import { saveFolderSpecRecord } from "#src/strategies/intermediate-representation/folder-spec/storage.ts";
import {
  AGREEMENT_THRESHOLD,
  MIN_FOLDER_SIZE,
  type FolderSpecRecord,
  type InheritableFields,
} from "#src/strategies/intermediate-representation/folder-spec/types.ts";

export interface DeriveFolderSpecsInput {
  knowledgeId: string;
  metaPaths: MetaPaths;
}

export interface DeriveFolderSpecsResult {
  foldersDerived: number;
  /** Folders skipped because they hold fewer than `MIN_FOLDER_SIZE` files. */
  foldersSkippedSmall: number;
  /** Folders that produced no claims (no field reached `AGREEMENT_THRESHOLD`). */
  foldersSkippedNoClaims: number;
}

/** Returns the most-common value when its share >= `AGREEMENT_THRESHOLD`, else `null`. */
function pickMode<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return bestCount / values.length >= AGREEMENT_THRESHOLD ? best : null;
}

function aggregateRepresentationFamily(files: readonly ModuleIr[]): RepresentationFamily | null {
  const mode = pickMode(files.map((f) => f.representationFamily));
  return mode !== null && mode !== "unknown" ? mode : null;
}

function aggregateRepresentationType(files: readonly ModuleIr[]): string | null {
  const nonEmpty = files.map((f) => f.representationType).filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return null;
  return pickMode(nonEmpty);
}

function aggregateLanguage(files: readonly ModuleIr[]): string | null {
  const mode = pickMode(files.map((f) => f.language));
  return mode !== null && mode.length > 0 && mode !== "unknown" ? mode : null;
}

function aggregateConcurrencyModel(files: readonly ModuleIr[]): ConcurrencyModel | null {
  const kind = pickMode(files.map((f) => f.concurrencyModel.kind));
  const ordering = pickMode(files.map((f) => f.concurrencyModel.ordering));
  const reentrant = pickMode(files.map((f) => f.concurrencyModel.reentrant));
  if (kind === null && ordering === null && reentrant === null) return null;
  return {
    kind: kind ?? "sync",
    reentrant: reentrant ?? false,
    ordering: ordering ?? "unknown",
    notes: "",
  };
}

function aggregateReconstructionHints(files: readonly ModuleIr[]): ReconstructionHints | null {
  const namingStyle = pickMode(files.map((f) => f.reconstructionHints.namingStyle));
  const returnStyle = pickMode(files.map((f) => f.reconstructionHints.returnStyle));
  const commentStyle = pickMode(files.map((f) => f.reconstructionHints.commentStyle));
  const dialects = files.map((f) => f.reconstructionHints.dialect).filter((s) => s.length > 0);
  const dialect = dialects.length > 0 ? pickMode(dialects) : null;
  if (namingStyle === null && returnStyle === null && commentStyle === null && dialect === null) {
    return null;
  }
  return {
    namingStyle: namingStyle ?? "unknown",
    returnStyle: returnStyle ?? "n/a",
    commentStyle: commentStyle ?? "none",
    dialect: dialect ?? "",
  };
}

function deriveInheritableFields(files: readonly ModuleIr[]): InheritableFields {
  return {
    representationFamily: aggregateRepresentationFamily(files),
    representationType: aggregateRepresentationType(files),
    concurrencyModel: aggregateConcurrencyModel(files),
    reconstructionHints: aggregateReconstructionHints(files),
    language: aggregateLanguage(files),
  };
}

function hasNoClaims(spec: InheritableFields): boolean {
  return (
    spec.representationFamily === null &&
    spec.representationType === null &&
    spec.concurrencyModel === null &&
    spec.reconstructionHints === null &&
    spec.language === null
  );
}

/** Returns the parent directory of `relativePath`, or `""` for repo-root files. */
function parentFolder(relativePath: string): string {
  const dir = path.posix.dirname(relativePath);
  return dir === "." ? "" : dir;
}

/** Enumerates every small-file analysis record on disk, grouped by parent folder. */
async function loadFilesByFolder(
  metaPaths: MetaPaths,
): Promise<Map<string, IrFileAnalysisRecord[]>> {
  const byFolder = new Map<string, IrFileAnalysisRecord[]>();
  let entries: string[];
  try {
    entries = await readdir(metaPaths.fileAnalysisDir);
  } catch {
    return byFolder;
  }
  for (const entry of entries) {
    const relativePath = decodeMetaPath(entry);
    const record = await readFileAnalysisRecordIfPresent(metaPaths, relativePath);
    if (record === null) continue;
    const folder = parentFolder(relativePath);
    const bucket = byFolder.get(folder);
    if (bucket === undefined) {
      byFolder.set(folder, [record]);
    } else {
      bucket.push(record);
    }
  }
  return byFolder;
}

/**
 * Runs phase 8 against every file-analysis record currently on disk.
 *
 * @param input - The knowledge id and meta-paths root.
 * @returns Counters for derived / skipped folders.
 */
export async function deriveFolderSpecs(
  input: DeriveFolderSpecsInput,
): Promise<DeriveFolderSpecsResult> {
  const result: DeriveFolderSpecsResult = {
    foldersDerived: 0,
    foldersSkippedSmall: 0,
    foldersSkippedNoClaims: 0,
  };
  const byFolder = await loadFilesByFolder(input.metaPaths);
  logger.info(
    `ir/derive-folder-specs starting: folders=${byFolder.size} (knowledgeId=${input.knowledgeId})`,
  );

  for (const [folderPath, files] of byFolder) {
    if (files.length < MIN_FOLDER_SIZE) {
      result.foldersSkippedSmall += 1;
      continue;
    }
    const spec = deriveInheritableFields(files.map((f) => f.analysis.module));
    if (hasNoClaims(spec)) {
      result.foldersSkippedNoClaims += 1;
      continue;
    }
    const record: FolderSpecRecord = {
      folderPath,
      contributingFiles: files.map((f) => f.relativePath).sort(),
      derivedAt: new Date().toISOString(),
      spec,
    };
    await saveFolderSpecRecord(input.metaPaths, record);
    result.foldersDerived += 1;
  }

  logger.info(
    `ir/derive-folder-specs done: derived=${result.foldersDerived} ` +
      `skipped-small=${result.foldersSkippedSmall} skipped-no-claims=${result.foldersSkippedNoClaims}`,
  );
  return result;
}
