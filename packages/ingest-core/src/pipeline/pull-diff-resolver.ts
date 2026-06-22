import { IngestError } from "@bb/errors";
import { logger } from "@bb/logger";
import { deepenClone, diffCommits, ensureCommitReachable, mergeBaseOf, type DiffResult } from "./git-diff.ts";

const DEEPEN_PASSES: readonly number[] = [50, 200];

/**
 * Ensure both endpoints of a pull diff are reachable in the local clone.
 * Tries up to two `git fetch --deepen` passes (50 then 200 commits). When
 * both endpoints are already present, returns immediately without any
 * network round-trip. The caller decides what to do if reachability is
 * still false after both passes — typically falling through to the
 * unrelated-history branch in `computePullDiff`.
 */
export async function materialiseEndpoints(
  repoDir: string,
  branch: string,
  currentCommit: string,
  targetCommit: string,
): Promise<void> {
  for (const depth of DEEPEN_PASSES) {
    const haveCurrent = await ensureCommitReachable(repoDir, currentCommit);
    const haveTarget = await ensureCommitReachable(repoDir, targetCommit);
    if (haveCurrent && haveTarget) {
      return;
    }
    logger.info(`pull: deepening clone to ${depth} on origin/${branch}`);
    await deepenClone(repoDir, branch, depth);
  }
}

/**
 * Compute the diff between two commits, falling back to a merge-base
 * union-diff when either endpoint is still unreachable after the deepen
 * passes. The fallback produces a conservative change set — every file
 * actually changed between current and target is included; some files may
 * appear changed when content matches across history. The strategy
 * re-analysing an unchanged file is wasteful, not incorrect.
 *
 * Throws `IngestError` when neither endpoint is reachable AND there is no
 * merge base — an unrelated-history anomaly worth surfacing.
 */
export async function computePullDiff(
  repoDir: string,
  currentCommit: string,
  targetCommit: string,
): Promise<DiffResult> {
  const haveCurrent = await ensureCommitReachable(repoDir, currentCommit);
  const haveTarget = await ensureCommitReachable(repoDir, targetCommit);
  if (haveCurrent && haveTarget) {
    return await diffCommits(repoDir, currentCommit, targetCommit);
  }
  const base = await mergeBaseOf(repoDir, currentCommit, targetCommit);
  if (base === null) {
    throw new IngestError(
      "",
      `pull: cannot represent diff — endpoints unreachable and no merge base between ${currentCommit.slice(0, 12)} and ${targetCommit.slice(0, 12)}`,
    );
  }
  logger.warn(`pull: endpoints unreachable; falling back to merge-base diff via ${base.slice(0, 12)}`);
  const a = await diffCommits(repoDir, currentCommit, base);
  const b = await diffCommits(repoDir, base, targetCommit);
  return unionDiff(a, b);
}

/**
 * Union two `DiffResult` change sets. Conservative — paths that appear in
 * both sides are deduped; rename entries are deduped by `newPath`.
 */
export function unionDiff(a: DiffResult, b: DiffResult): DiffResult {
  const added = new Set<string>([...a.added, ...b.added]);
  const modified = new Set<string>([...a.modified, ...b.modified]);
  const deleted = new Set<string>([...a.deleted, ...b.deleted]);
  const renamesByNewPath = new Map<string, { oldPath: string; newPath: string; similarity: number }>();
  for (const r of [...a.renamed, ...b.renamed]) {
    renamesByNewPath.set(r.newPath, r);
  }
  return {
    added: [...added],
    modified: [...modified],
    deleted: [...deleted],
    renamed: [...renamesByNewPath.values()],
  };
}
