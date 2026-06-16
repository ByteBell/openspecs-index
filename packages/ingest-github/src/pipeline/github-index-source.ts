import { IngestError } from "@bb/errors";
import { logger } from "@bb/logger";
import {
  ensureCommitDirs,
  pathsFor,
  createDiskSourceReader,
  type RepoLocation,
  type ArchiveSink,
  type SourceReader,
  type IndexSourceResolver,
} from "@bb/ingest-core";
import { readHeadCommitHash, syncRepository } from "./source.ts";
import { resolveBranch } from "./branch.ts";
import { fetchLatestCommitHash } from "#src/githubApi.ts";
import { parseGithubRepo } from "#src/githubUrl.ts";

// ─────────────────────────────────────────────────────────────────────────────
// GitHub implementation of the provider-agnostic `IndexSourceResolver` seam.
//
// Resolves the branch + repo coordinates, then either delegates to the injected
// `sourceFactory` (api-streaming / no-clone path) or clones into the
// commit-scoped `repository/` dir. Returns a provider-neutral resolution that an
// index router (OSS `runGithub`, or a private out-of-tree router) feeds to the
// strategy. Extracted from `run.ts` so both routers share the github source
// logic without duplicating it.
// ─────────────────────────────────────────────────────────────────────────────

export const resolveGithubIndexSource: IndexSourceResolver = async (input) => {
  const { knowledgeId, payload, orgId, sourceFactory } = input;
  const branch = await resolveBranch(knowledgeId, payload, payload.gitToken);
  // Parse (owner, repo) up front — we need them to build the commit-scoped path
  // *before* cloning. parseGithubRepo handles `.git`, `tree/branch` suffixes,
  // and SSH-style URLs (and gitlab.com hosts, for the GitLab provider reuse).
  const parsed = parseGithubRepo(payload.repoUrl);
  if (parsed === null) {
    throw new IngestError(knowledgeId, `could not parse owner/repo from repoUrl=${payload.repoUrl}`);
  }
  const { owner, repo } = parsed;

  let source: SourceReader;
  let archiveSink: ArchiveSink | undefined;
  let commitHash: string;
  let location: RepoLocation;

  if (sourceFactory !== undefined) {
    const factoryResult = await sourceFactory({ knowledgeId, payload, branch });
    source = factoryResult.source;
    commitHash = factoryResult.commitHash;
    archiveSink = factoryResult.archiveSink;
    location = { provider: "github", orgId, knowledgeId, owner, repo, commitHash };
    // The factory has already produced the source tree; meta-output dirs still
    // need to exist before the strategy writes scan-manifest.json. Idempotent.
    await ensureCommitDirs(location);
    logger.info(`pipeline/run: source factory wired (knowledgeId=${knowledgeId}, commit=${commitHash.slice(0, 12)})`);
    return { source, archiveSink, commitHash, branch, location, owner, repo };
  }

  // Resolve the HEAD commit SHA before cloning so we can clone *directly* into
  // the commit-scoped `repository/` dir — no staging rename. Uses the GitHub
  // REST `/branches/{branch}` endpoint via fetchLatestCommitHash.
  const resolvedSha = await fetchLatestCommitHash(payload.repoUrl, branch, payload.gitToken);
  if (resolvedSha === null) {
    throw new IngestError(
      knowledgeId,
      `could not resolve HEAD commit hash for ${owner}/${repo}@${branch} before clone`,
    );
  }
  location = { provider: "github", orgId, knowledgeId, owner, repo, commitHash: resolvedSha };
  await ensureCommitDirs(location);
  const repoDir = pathsFor(location).repositoryDir;
  const cloneOpts: { repoUrl: string; branch: string; destinationDir: string; gitToken?: string } = {
    repoUrl: payload.repoUrl,
    branch,
    destinationDir: repoDir,
  };
  if (payload.gitToken !== undefined) {
    cloneOpts.gitToken = payload.gitToken;
  }
  await syncRepository(cloneOpts);
  const postCloneSha = await readHeadCommitHash(repoDir);
  if (postCloneSha === "unknown") {
    throw new IngestError(knowledgeId, "could not resolve HEAD commit hash after clone");
  }
  commitHash = postCloneSha;
  if (postCloneSha !== resolvedSha) {
    logger.warn(
      `pipeline/run: commit drift between REST and clone for ${knowledgeId} (rest=${resolvedSha.slice(0, 12)} clone=${postCloneSha.slice(0, 12)}); using clone SHA`,
    );
    location = { ...location, commitHash: postCloneSha };
    await ensureCommitDirs(location);
  }
  source = createDiskSourceReader({ repoDir, commitHash });
  return { source, archiveSink: undefined, commitHash, branch, location, owner, repo };
};
