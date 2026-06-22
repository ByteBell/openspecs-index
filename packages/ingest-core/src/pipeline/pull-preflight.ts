import { type GithubPullPayload, type JobMessage } from "@bb/types";
import { knowledgeDb } from "@bb/db";
import { IngestError, KnowledgeNotFoundError } from "@bb/errors";
import type { PullFactory } from "#src/types/pipeline.ts";

const COMMIT_HASH_RE = /^[0-9a-f]{40}$/u;

export interface PullPreflight {
  currentCommit: string;
  branch: string;
  repoUrl: string;
  gitToken: GithubPullPayload["gitToken"];
}

// Validates the pull payload + knowledge doc at the boundary and resolves the
// fields the pipeline consumes. Throws IngestError / KnowledgeNotFoundError on
// any precondition miss; performs no state mutation or side effects.
export async function preflightPull(
  msg: JobMessage<GithubPullPayload>,
  pullFactory: PullFactory | undefined,
): Promise<PullPreflight> {
  const { knowledgeId } = msg.payload;
  if (msg.payload.targetCommitHash !== undefined && !COMMIT_HASH_RE.test(msg.payload.targetCommitHash)) {
    throw new IngestError(
      knowledgeId,
      `targetCommitHash must be a 40-character hex SHA, got: ${msg.payload.targetCommitHash}`,
    );
  }

  const kDoc = await knowledgeDb.getKnowledge(knowledgeId);
  if (kDoc === null) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
  // When a `pullFactory` is injected the caller owns provider resolution (mirrors
  // how an injected `SourceFactory` signals provider-handled ingest), so skip the
  // GitHub-only assertion. OSS standalone passes no factory → guard stays enforced.
  if (pullFactory === undefined && kDoc.source.kind !== "github") {
    throw new IngestError(knowledgeId, `pull is only supported for github knowledge (kind=${kDoc.source.kind})`);
  }
  // Provider wrappers (e.g. GitLab) forward the prior commit via the payload since
  // their source kind may store it outside `source.commitId`. Prefer that; fall back
  // to `source.commitId` for GitHub.
  const currentCommit =
    msg.payload.previousCommit ?? (kDoc.source.kind === "github" ? (kDoc.source.commitId ?? "") : "");
  if (currentCommit.length === 0) {
    throw new IngestError(
      knowledgeId,
      "pull requires a previously-indexed commit; this knowledge has no commitId. Run github_index first.",
    );
  }

  const branch = kDoc.info.branch ?? "main";
  const repoUrl = kDoc.info.repoUrl;
  if (repoUrl === undefined || repoUrl.length === 0) {
    throw new IngestError(knowledgeId, "pull requires knowledge.info.repoUrl");
  }

  return { currentCommit, branch, repoUrl, gitToken: msg.payload.gitToken };
}
