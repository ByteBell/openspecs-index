/**
 * Helpers for reusing per-unit analysis records across edits and chunk shifts.
 *
 * Background: cross-commit invalidation (see `incremental.ts`) preserves every per-unit
 * directory when a parent file is modified. The `extract-unit-sources` stage then drives
 * "is the old analysis still valid?" by comparing the new source slice's sha256 against
 * the existing source.json's sha256 at the candidate location.
 *
 * Two cases the helpers below cover:
 *
 *  1. Exact-target match — small file, or big-file unit whose chunk number did not shift.
 *     If `existing.sha256 === new.sha256`, the old `<qn>.analysis.json` next to it is still
 *     valid; `analyse-units` will skip it via its existing presence check. The stage handles
 *     this inline (read + compare); no helper needed here.
 *
 *  2. Cross-chunk migration — big file only. After a re-cut the same unit may have moved
 *     from chunk-3 to chunk-5; the old analysis sits under
 *     `<encoded(<rel>:chunk-3__<qn>)>/...`. `findReusableBigFileUnitAnalysis` walks every
 *     sibling matching `<encoded(<rel>):chunk-*__<qn>` and returns the first whose stored
 *     sha matches the new source. `migrateAndRestampUnitAnalysis` copies that analysis to
 *     the new location, restamping the addressing fields (`relativePath`, `chunkNumber`,
 *     `fileId`, `unitId` — both on the wrapper AND inside `codeUnit`) so downstream
 *     consumers see the current chunk. `removeBigFileUnitTopLevelDir` then deletes the
 *     stale sibling.
 *
 * All operations are best-effort: missing files / parse failures fall through to "no reuse",
 * which makes `extract-unit-sources` fall back to its existing fresh-write path. The
 * helpers never throw on cache misses.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bigFileDirFor,
  encodeMetaPath,
  unitAnalysisRecordPath,
  unitSourceRecordPath,
} from "#src/pipeline/paths.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { IrUnitAnalysisRecord, IrUnitSourceRecord } from "./types.ts";

const DIR_MODE = 0o700;
const CHUNK_NUM_RE = /:chunk-(\d+)__/u;

interface ReusableBigFileUnitAnalysis {
  unitFileId: string;
  chunkNumber: number;
  sourcePath: string;
  analysisPath: string;
}

async function readJsonIfPresent<T>(file: string): Promise<T | null> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Walks every sibling under `bigFileAnalysisDir` whose encoded name matches the pattern
 * `<encoded(parentRelativePath)>:chunk-<N>__<encoded(qualifiedName)>`, reads each one's
 * `<qn>.source.json`, and returns the first whose stored sha256 matches `expectedSha256`.
 *
 * Returns `null` when:
 *  - `bigFileAnalysisDir` does not exist
 *  - no sibling matches the prefix/suffix pattern
 *  - no matching sibling stores a source.json with the expected sha
 */
export async function findReusableBigFileUnitAnalysis(input: {
  metaPaths: MetaPaths;
  parentRelativePath: string;
  qualifiedName: string;
  expectedSha256: string;
}): Promise<ReusableBigFileUnitAnalysis | null> {
  const encodedParent = encodeMetaPath(input.parentRelativePath);
  const encodedQn = encodeMetaPath(input.qualifiedName);
  const prefix = `${encodedParent}:chunk-`;
  const suffix = `__${encodedQn}`;

  let entries: string[];
  try {
    entries = await readdir(input.metaPaths.bigFileAnalysisDir);
  } catch {
    return null;
  }

  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
      continue;
    }
    const match = CHUNK_NUM_RE.exec(name);
    if (match === null) {
      continue;
    }
    const numStr = match[1];
    if (numStr === undefined) {
      continue;
    }
    const chunkNumber = Number.parseInt(numStr, 10);
    // `name` is the encoded unitFileId — pass it straight to the path builders. Re-encoding
    // is idempotent here (already-encoded `__SL__` contains no `/` or `\`).
    const candidateUnitFileId = name;
    const sourcePath = unitSourceRecordPath(
      input.metaPaths,
      candidateUnitFileId,
      chunkNumber,
      input.qualifiedName,
    );
    const oldSource = await readJsonIfPresent<IrUnitSourceRecord>(sourcePath);
    if (oldSource === null || oldSource.sha256 !== input.expectedSha256) {
      continue;
    }
    const analysisPath = unitAnalysisRecordPath(
      input.metaPaths,
      candidateUnitFileId,
      chunkNumber,
      input.qualifiedName,
    );
    return { unitFileId: candidateUnitFileId, chunkNumber, sourcePath, analysisPath };
  }
  return null;
}

/**
 * Copies `fromPath` (an old `IrUnitAnalysisRecord` JSON) to `toPath`, restamping the
 * addressing fields so the new record is internally consistent with its new location:
 *
 *   wrapper: { relativePath, chunkNumber, fileId, unitId }
 *   codeUnit: { fileId, unitId }
 *
 * Every other field — the structural IR (calls, signatures, fingerprint) and the accounting
 * (tokenUsage, model, attempts, analysedAt) — is preserved verbatim. Callers only migrate
 * after a sha match, so the source content is byte-identical and the structural IR remains
 * semantically correct under the new addressing.
 *
 * Returns `true` on success, `false` if the old record could not be read or written.
 */
export async function migrateAndRestampUnitAnalysis(input: {
  fromPath: string;
  toPath: string;
  newRelativePath: string;
  newChunkNumber: number | null;
  newFileId: string;
  newUnitId: string;
}): Promise<boolean> {
  const old = await readJsonIfPresent<IrUnitAnalysisRecord>(input.fromPath);
  if (old === null) {
    return false;
  }
  const restamped: IrUnitAnalysisRecord = {
    ...old,
    relativePath: input.newRelativePath,
    chunkNumber: input.newChunkNumber,
    fileId: input.newFileId,
    unitId: input.newUnitId,
    codeUnit: {
      ...old.codeUnit,
      fileId: input.newFileId,
      unitId: input.newUnitId,
    },
  };
  try {
    await mkdir(path.dirname(input.toPath), { recursive: true, mode: DIR_MODE });
    await writeFile(input.toPath, JSON.stringify(restamped, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Best-effort `rm -rf` on the top-level encoded big-file unit directory. */
export async function removeBigFileUnitTopLevelDir(
  metaPaths: MetaPaths,
  unitFileId: string,
): Promise<void> {
  try {
    await rm(bigFileDirFor(metaPaths, unitFileId), { recursive: true, force: true });
  } catch {
    // best-effort; orphan dirs are harmless to downstream readers
  }
}
