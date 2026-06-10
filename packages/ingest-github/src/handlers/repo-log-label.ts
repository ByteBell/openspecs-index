// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import path from "node:path";
import type { GithubIndexPayload, LocalIngestPayload } from "@bb/types";
import { parseGithubRepo } from "#src/githubUrl.ts";

/**
 * Builds the filename stem for a job's per-repo log file (see
 * `@bb/logger`'s `withRepoLog`). The stem is human-recognisable — `owner-repo`
 * for GitHub, the directory basename for local ingest — suffixed with a short
 * slice of the knowledgeId so two repos that share a name never collide.
 *
 * `@bb/logger` sanitizes the result defensively; this helper just aims for a
 * label a human can scan in `logs/archive/`.
 */
export function githubRepoLogLabel(payload: GithubIndexPayload): string {
  const parsed = parseGithubRepo(payload.repoUrl);
  const base = parsed !== null ? `${parsed.owner}-${parsed.repo}` : "repo";
  return `${base}-${shortId(payload.knowledgeId)}`;
}

export function localRepoLogLabel(payload: LocalIngestPayload): string {
  const base = path.basename(payload.rootDir) || "local";
  return `local-${base}-${shortId(payload.knowledgeId)}`;
}

function shortId(knowledgeId: string): string {
  return knowledgeId.slice(0, 8);
}
