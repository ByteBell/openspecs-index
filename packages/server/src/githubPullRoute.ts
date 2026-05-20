import type { Request, Response, Router } from "express";
import express from "express";
import { isFullCommitHash, resolveIndexedCommit } from "@bb/types";
import { getKnowledge } from "@bb/mongo";
import { enqueueGithubPull } from "@bb/queue";
import { fetchLatestCommitHash } from "@bb/ingest-github";

interface PullBody {
  knowledgeId?: unknown;
  targetCommitHash?: unknown;
  gitToken?: unknown;
}

interface PullResponse {
  knowledgeId: string;
  jobId?: string;
  noOp?: boolean;
  commitHash?: string;
}

/**
 * `POST /api/v1/github/pull` — re-index a github knowledge to a specific commit
 * reachable from its indexed branch. When the caller omits `targetCommitHash`,
 * the route resolves the branch's HEAD via the GitHub API as a best-effort
 * pre-enqueue convenience. The worker repeats the resolution after clone as
 * the canonical guard.
 *
 * Direction does not matter — forward (catch-up), backward (rollback), and
 * sideways (any commit on the same branch) all run the same orchestrator.
 * Cross-branch pulls are rejected at the worker; the caller must create a
 * fresh github_index job to switch branches.
 *
 * See `docs/pull-plan.md` for the full pipeline description.
 */
export function buildGithubPullRoute(): Router {
  const router = express.Router();
  router.post("/api/v1/github/pull", async (req: Request, res: Response) => {
    const body = req.body as PullBody;
    if (typeof body.knowledgeId !== "string" || body.knowledgeId.length === 0) {
      res.status(400).json({ error: "knowledgeId required" });
      return;
    }
    const knowledgeId = body.knowledgeId;

    const gitToken = typeof body.gitToken === "string" && body.gitToken.length > 0 ? body.gitToken : undefined;
    const suppliedTarget =
      typeof body.targetCommitHash === "string" && body.targetCommitHash.length > 0 ? body.targetCommitHash : undefined;
    if (suppliedTarget !== undefined && !isFullCommitHash(suppliedTarget)) {
      res.status(400).json({
        error: "invalid targetCommitHash",
        message: "targetCommitHash must be a 40-character hex SHA",
      });
      return;
    }

    const knowledge = await getKnowledge(knowledgeId);
    if (knowledge === null) {
      res.status(404).json({ error: "knowledge not found" });
      return;
    }
    if (knowledge.source.kind !== "github") {
      res.status(422).json({ error: `pull is only supported for github knowledge (kind=${knowledge.source.kind})` });
      return;
    }
    const currentCommit = resolveIndexedCommit(knowledge.source);
    if (currentCommit === undefined) {
      res.status(422).json({
        error: "knowledge not yet indexed",
        message: "pull requires a previously-indexed commit; this knowledge has no commitId. Run github_index first.",
      });
      return;
    }

    const branch = knowledge.source.branch ?? "main";
    let targetCommit = suppliedTarget?.toLowerCase();
    if (targetCommit === undefined) {
      try {
        const head = await fetchLatestCommitHash(knowledge.source.repoUrl, branch, gitToken);
        if (isFullCommitHash(head)) {
          targetCommit = head.toLowerCase();
        }
      } catch {
        // Transient API failure; leave target unset and let the worker resolve via git rev-parse.
      }
    }

    if (targetCommit !== undefined && targetCommit === currentCommit) {
      const response: PullResponse = { knowledgeId, noOp: true, commitHash: targetCommit };
      res.status(200).json(response);
      return;
    }

    const payload: { knowledgeId: string; targetCommitHash?: string; gitToken?: string } = { knowledgeId };
    if (targetCommit !== undefined) {
      payload.targetCommitHash = targetCommit;
    }
    if (gitToken !== undefined) {
      payload.gitToken = gitToken;
    }
    const jobId = await enqueueGithubPull(payload);
    const response: PullResponse = {
      knowledgeId,
      jobId,
      ...(targetCommit !== undefined ? { commitHash: targetCommit } : {}),
    };
    res.status(200).json(response);
  });
  return router;
}
