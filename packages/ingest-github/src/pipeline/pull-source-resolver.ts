import { IngestError } from "@bb/errors";
import { logger } from "@bb/logger";
import {
  ensureCommitDirs,
  pathsFor,
  type RepoLocation,
  assertReachableFromBranch,
  checkoutCommit,
  computePullDiff,
  materialiseEndpoints,
  createDiskSourceReader,
  type ResolvePullSourceInput,
  type PullSourceResolution,
} from "@bb/ingest-core";
import { readHeadCommitHash, syncRepository } from "./source.ts";
import { fetchLatestCommitHash } from "#src/githubApi.ts";
import { parseGithubRepo } from "#src/githubUrl.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Resolves the "repository state" prelude for `runPull`:
//   1. Pre-clone resolution of `targetCommit` (operator-supplied or branch HEAD).
//   2. Builds the commit-scoped `RepoLocation` so the clone lands directly in
//      `repository/`.
//   3. Performs the clone + history deepening + diff computation, OR delegates
//      to the optional `pullFactory` (no-clone path for downstream consumers).
//   4. Short-circuits to a no-op when target == current.
//
// Returns either `{ kind: "noop" }` (caller transitions state + returns empty
// summary) or `{ kind: "ready", source, diff, targetCommit, location,
// archiveSink? }` (caller proceeds with the analysis phases).
//
// Extracted from `pull.ts` to keep that file under the 300-line cap. The
// `PullSourceResolution` / `ResolvePullSourceInput` contracts live in
// `@bb/ingest-core`; this is the GitHub implementation of `PullSourceResolver`.
// ─────────────────────────────────────────────────────────────────────────────

export async function resolvePullSource(input: ResolvePullSourceInput): Promise<PullSourceResolution> {
  const { knowledgeId, payload, currentCommit, branch, repoUrl, gitToken, orgId, pullFactory } = input;
  // GitHub-specific: derive owner/repo from the repo URL. The provider-agnostic
  // driver no longer parses this — it is the resolver's concern.
  const parsed = parseGithubRepo(repoUrl);
  if (parsed === null) {
    throw new IngestError(knowledgeId, `could not parse owner/repo from repoUrl=${repoUrl}`);
  }
  const { owner, repo } = parsed;

  if (pullFactory !== undefined) {
    const factoryResult = await pullFactory({ knowledgeId, payload, currentCommit, branch });
    const location: RepoLocation = {
      provider: "github",
      orgId,
      knowledgeId,
      owner,
      repo,
      commitHash: factoryResult.targetCommit,
    };
    logger.info(
      `pull: pull factory wired (knowledgeId=${knowledgeId}, target=${factoryResult.targetCommit.slice(0, 12)})`,
    );
    if (factoryResult.targetCommit === currentCommit) {
      return { kind: "noop", targetCommit: factoryResult.targetCommit };
    }
    // No-clone (streaming) path: the factory produced the source tree remotely, but the
    // local meta-output dirs (file-analysis, folder-summaries, …) must still exist so
    // analyse-changed's `saveCondensed` can persist analysis — otherwise every changed
    // file is silently lost and the pull falsely reports "no analyzable changes".
    // Mirrors the index factory branch in run.ts.
    await ensureCommitDirs(location);
    return {
      kind: "ready",
      source: factoryResult.source,
      diff: factoryResult.diff,
      targetCommit: factoryResult.targetCommit,
      location,
      owner,
      repo,
      archiveSink: factoryResult.archiveSink,
    };
  }

  // Resolve targetCommit BEFORE clone so the clone can land directly in the
  // commit-scoped `repository/` dir. Operator-supplied `targetCommitHash`
  // wins; otherwise the GitHub REST API gives us the current branch HEAD.
  let resolvedTarget = payload.targetCommitHash;
  if (resolvedTarget === undefined) {
    const headSha = await fetchLatestCommitHash(repoUrl, branch, gitToken);
    if (headSha === null) {
      throw new IngestError(knowledgeId, `could not resolve branch HEAD for ${owner}/${repo}@${branch}`);
    }
    resolvedTarget = headSha;
  }
  if (resolvedTarget === currentCommit) {
    return { kind: "noop", targetCommit: resolvedTarget };
  }

  let location: RepoLocation = {
    provider: "github",
    orgId,
    knowledgeId,
    owner,
    repo,
    commitHash: resolvedTarget,
  };
  await ensureCommitDirs(location);
  const repoDir = pathsFor(location).repositoryDir;
  const cloneOpts: { repoUrl: string; branch: string; destinationDir: string; gitToken?: string } = {
    repoUrl,
    branch,
    destinationDir: repoDir,
  };
  if (gitToken !== undefined) {
    cloneOpts.gitToken = gitToken;
  }
  await syncRepository(cloneOpts);

  const branchHead = await readHeadCommitHash(repoDir);
  if (branchHead === "unknown") {
    throw new IngestError(knowledgeId, "could not resolve branch HEAD after clone");
  }
  // If the operator didn't specify a target, accept the post-clone HEAD
  // (handles drift between resolve and clone). For an explicit target, keep
  // the requested value — `materialiseEndpoints` + `checkoutCommit` will
  // navigate to it inside the deepened history.
  const targetCommit = payload.targetCommitHash ?? branchHead;
  if (targetCommit !== resolvedTarget) {
    logger.warn(
      `pull: commit drift between REST and clone for ${knowledgeId} (resolved=${resolvedTarget.slice(0, 12)} actual=${targetCommit.slice(0, 12)}); rebuilding paths under actual`,
    );
    location = { ...location, commitHash: targetCommit };
    await ensureCommitDirs(location);
  }

  // Deepen the shallow clone first so historical commits selected via the
  // picker become visible to `merge-base --is-ancestor`. Without this the
  // assertion below rejects every non-HEAD pick on a `--depth=1` clone.
  await materialiseEndpoints(repoDir, branch, currentCommit, targetCommit);

  if (!(await assertReachableFromBranch(repoDir, targetCommit, branch))) {
    throw new IngestError(
      knowledgeId,
      `target commit ${targetCommit} is not reachable from origin/${branch}. Cross-branch pulls are not supported; create a fresh github_index job for the new branch.`,
    );
  }

  const diff = await computePullDiff(repoDir, currentCommit, targetCommit);
  await checkoutCommit(repoDir, targetCommit);
  const source = createDiskSourceReader({ repoDir, commitHash: targetCommit });

  return { kind: "ready", source, diff, targetCommit, location, owner, repo, archiveSink: undefined };
}
