/**
 * Cross-run incremental helpers for the IR strategy. A driver that processes a sequence of
 * commits for the same `knowledgeId` (one repo, many commits — see project rule) calls these
 * before running the phases for each commit:
 *
 *   1) `findPriorIndexedCommit` — walks the caller-supplied candidate list backward and returns
 *      the first earlier commit whose `metaRoot` already has artifacts on disk. This is what
 *      makes cross-run resumption work: after the driver restarts, the in-memory `prevCommit`
 *      is gone but the on-disk `metaRoot` from an earlier run is still there.
 *   2) `applyDiffInvalidation` — copies cached IR artifacts from `prevMetaRoot` into
 *      `currMetaRoot`, then invalidates the entries the diff touches. Modified files (and
 *      `renamed.newPath`) get a partial wipe that KEEPS per-unit directories — so when a unit's
 *      source slice is byte-identical across the edit, `extract-unit-sources` reuses the
 *      existing `<qn>.analysis.json` and `analyse-units` skips the LLM call. Deleted files
 *      (and `renamed.oldPath`) get a full wipe (file-level records AND per-unit siblings).
 *   3) `logCommitDiff` / `logNoPriorCommit` — structured INFO lines so the driver and the logs
 *      both record which mode the run is in.
 *
 * The IR strategy itself is unchanged; these are driver-facing utilities. The flat-folder
 * strategy's pull path (`pipeline/pull.ts` + `analyseChangedFiles`) already does the equivalent
 * via Mongo's `knowledge.source.commitId` — drivers that bypass the pull pipeline (e.g. a
 * benchmark replayer) use these helpers instead.
 */
import fs from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { logger } from "@bb/logger";
import { encodeMetaPath } from "#src/pipeline/paths.ts";
import type { DiffResult } from "#src/pipeline/git-diff.ts";

export interface PriorIndexedCommitCandidate {
  commit: string;
  metaRoot: string;
}

export interface PriorIndexedCommit {
  commit: string;
  metaRoot: string;
}

/**
 * Walks `candidates` from the last element backward and returns the first one whose `metaRoot`
 * exists on disk. Caller is responsible for ordering: pass the commits that chronologically
 * precede the current one, in the same order the driver would have processed them. Returns
 * `undefined` when no candidate has been indexed (i.e. this is the first run for this repo).
 */
export function findPriorIndexedCommit(
  candidates: readonly PriorIndexedCommitCandidate[],
): PriorIndexedCommit | undefined {
  for (let j = candidates.length - 1; j >= 0; j -= 1) {
    const candidate = candidates[j];
    if (candidate === undefined) {
      continue;
    }
    if (fs.existsSync(candidate.metaRoot)) {
      return { commit: candidate.commit, metaRoot: candidate.metaRoot };
    }
  }
  return undefined;
}

export interface ApplyDiffInvalidationInput {
  prevMetaRoot: string;
  currMetaRoot: string;
  diff: DiffResult;
}

export interface ApplyDiffInvalidationResult {
  /** Number of top-level meta subdirectories copied from `prevMetaRoot` to `currMetaRoot`. */
  copiedDirs: number;
  /** Number of distinct relative paths whose cached records were deleted from `currMetaRoot`. */
  invalidatedPaths: number;
}

/**
 * Copies cached IR artifacts (`file-analysis`, `big-file-analysis`) from `prevMetaRoot` into
 * `currMetaRoot`, then invalidates the entries the diff touches.
 *
 * - `added` paths have no cached record and need no invalidation.
 * - `modified` paths AND `renamed.newPath` → file-level records removed, per-unit directories
 *   preserved so `extract-unit-sources` can sha-match and reuse old `<qn>.analysis.json`.
 * - `deleted` paths AND `renamed.oldPath` → fully wiped (file-level records AND every
 *   per-unit sibling directory).
 */
export async function applyDiffInvalidation(
  input: ApplyDiffInvalidationInput,
): Promise<ApplyDiffInvalidationResult> {
  const subdirs = ["file-analysis", "big-file-analysis"] as const;
  let copiedDirs = 0;
  for (const sub of subdirs) {
    const from = path.join(input.prevMetaRoot, sub);
    const to = path.join(input.currMetaRoot, sub);
    if (!fs.existsSync(from)) {
      continue;
    }
    await cp(from, to, { recursive: true, force: true });
    copiedDirs += 1;
  }

  // Two invalidation modes:
  //
  //   - `preserveUnits` (modified files + renamed.newPath): delete only the parent dirs that
  //     hold file-level records (`analysis.json`, `boundaries.json`, `cut-complete.json`,
  //     `chunks/chunk-N/{raw,analysis}.json`). KEEP every per-unit sibling directory so the
  //     `extract-unit-sources` stage can sha-compare the new source slice against the old
  //     `<qn>.source.json` and reuse the old `<qn>.analysis.json` when content didn't change.
  //
  //   - `fullWipe` (deleted files + renamed.oldPath): the parent path will not be revisited
  //     by the current commit's pipeline, so every artifact for it — parent dirs AND per-unit
  //     sibling dirs — must go.
  const preserveUnits = new Set<string>([
    ...input.diff.modified,
    ...input.diff.renamed.map((r) => r.newPath),
  ]);
  const fullWipe = new Set<string>([
    ...input.diff.deleted,
    ...input.diff.renamed.map((r) => r.oldPath),
  ]);

  const fileAnalysisDir = path.join(input.currMetaRoot, "file-analysis");
  const bigFileAnalysisDir = path.join(input.currMetaRoot, "big-file-analysis");
  for (const relativePath of preserveUnits) {
    await invalidateFileLevelOnly(fileAnalysisDir, bigFileAnalysisDir, relativePath);
  }
  for (const relativePath of fullWipe) {
    await invalidateOnePath(fileAnalysisDir, bigFileAnalysisDir, relativePath);
  }

  return {
    copiedDirs,
    invalidatedPaths: preserveUnits.size + fullWipe.size,
  };
}

/**
 * Removes every cached artifact attached to one parent `relativePath`. Layout reminder
 * (must stay in sync with `pipeline/paths.ts`):
 *
 *   <metaRoot>/file-analysis/<enc(rel)>/                  → small-file analysis.json + codeUnits/
 *   <metaRoot>/file-analysis/<enc(rel)>__<qn>/            → small-file per-unit sources / analyses
 *   <metaRoot>/big-file-analysis/<enc(rel)>/              → boundaries.json + cut-complete.json + chunks/
 *   <metaRoot>/big-file-analysis/<enc(rel)>:chunk-N__<qn>/→ big-file per-unit sources / analyses
 *
 * For (2) and (4) the children are sibling directories named `<enc(rel)>__…` and
 * `<enc(rel)>:chunk-…` — `rm`'ing the parent does NOT touch them, so we enumerate the
 * sibling listing and rm-by-prefix instead. The previous implementation tried to remove
 * `<enc(rel)>.json` / `<enc(rel)>.boundaries.json` / `chunks/<enc(rel)>` paths that don't
 * exist in the current layout, so cross-commit invalidation never actually deleted anything.
 */
async function invalidateOnePath(
  fileAnalysisDir: string,
  bigFileAnalysisDir: string,
  relativePath: string,
): Promise<void> {
  const encoded = encodeMetaPath(relativePath);

  // (1) small-file parent
  await rm(path.join(fileAnalysisDir, encoded), { recursive: true, force: true });
  // (2) small-file per-unit children — siblings prefixed with `${encoded}__`
  await removeSiblingsWithPrefix(fileAnalysisDir, `${encoded}__`);

  // (3) big-file parent (boundaries + cut-complete + every chunk-N/)
  await rm(path.join(bigFileAnalysisDir, encoded), { recursive: true, force: true });
  // (4) big-file per-chunk per-unit children — siblings prefixed with `${encoded}:chunk-`
  await removeSiblingsWithPrefix(bigFileAnalysisDir, `${encoded}:chunk-`);
}

/**
 * Modified-file invalidation. Deletes ONLY the directories that hold file-level records.
 * Keeps every per-unit directory in place so `extract-unit-sources` can sha-compare and
 * reuse the matching `<qn>.analysis.json` (skipping the per-unit LLM call).
 *
 * Concretely, for a file at repo path `lib/foo.ts` (encoded as `lib__SL__foo.ts`):
 *
 *   REMOVED
 *     <metaRoot>/file-analysis/lib__SL__foo.ts/
 *         analysis.json                                     ← file-analysis result
 *     <metaRoot>/big-file-analysis/lib__SL__foo.ts/
 *         boundaries.json                                   ← computed cut points
 *         cut-complete.json                                 ← phase-4 completion marker
 *         chunks/chunk-N/raw.json                           ← cut chunk content
 *         chunks/chunk-N/analysis.json                      ← chunk-level file-analysis result
 *
 *   PRESERVED
 *     <metaRoot>/file-analysis/lib__SL__foo.ts__<qn>/
 *         codeUnits/<qn>.source.json                        ← per-unit source slice
 *         codeUnits/<qn>.analysis.json                      ← per-unit deep IR
 *     <metaRoot>/big-file-analysis/lib__SL__foo.ts:chunk-N__<qn>/
 *         chunks/chunk-N/codeUnits/<qn>.source.json
 *         chunks/chunk-N/codeUnits/<qn>.analysis.json
 *
 * After this runs, `analyse-small`, `compute-boundaries`, `cut-big-files`, and
 * `analyse-big-chunks` all re-run for the file. The preserved per-unit directories are then
 * picked up by `extract-unit-sources`: matching sha256 → reuse the old analysis; mismatch →
 * delete the stale analysis and let `analyse-units` re-run for that unit only.
 */
async function invalidateFileLevelOnly(
  fileAnalysisDir: string,
  bigFileAnalysisDir: string,
  relativePath: string,
): Promise<void> {
  const encoded = encodeMetaPath(relativePath);
  await rm(path.join(fileAnalysisDir, encoded), { recursive: true, force: true });
  await rm(path.join(bigFileAnalysisDir, encoded), { recursive: true, force: true });
}

/**
 * `rm -rf <parentDir>/<name>` for every direct child of `parentDir` whose name starts with
 * `prefix`. Silently skips when the parent directory does not exist (a never-cut big file
 * has no big-file-analysis dir at all). Failures on individual entries log and continue —
 * one stuck path must not abort the rest of the invalidation pass.
 */
async function removeSiblingsWithPrefix(parentDir: string, prefix: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(parentDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(prefix)) {
      continue;
    }
    const target = path.join(parentDir, name);
    try {
      await rm(target, { recursive: true, force: true });
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      logger.warn(`applyDiffInvalidation: could not remove ${target}: ${msg}`);
    }
  }
}

export interface LogCommitDiffInput {
  prevCommit: string;
  currentCommit: string;
  diff: DiffResult;
}

/**
 * Structured INFO line emitted when a commit is being indexed incrementally against a known
 * prior commit. Shape:
 *
 *   ir/incremental: <prev[..12]> → <curr[..12]>  added=N modified=N deleted=N renamed=N
 */
export function logCommitDiff(input: LogCommitDiffInput): void {
  logger.info(
    `ir/incremental: ${input.prevCommit.slice(0, 12)} → ${input.currentCommit.slice(0, 12)} ` +
      `added=${input.diff.added.length} modified=${input.diff.modified.length} ` +
      `deleted=${input.diff.deleted.length} renamed=${input.diff.renamed.length}`,
  );
}

export interface LogNoPriorCommitInput {
  currentCommit: string;
}

/**
 * Structured INFO line emitted when no prior commit has been indexed for this repo. Signals to
 * the operator that the run will do a full first-time index (no diff, no invalidation).
 */
export function logNoPriorCommit(input: LogNoPriorCommitInput): void {
  logger.info(
    `ir/incremental: ${input.currentCommit.slice(0, 12)} — no prior indexed commit found, running full first-time index`,
  );
}
