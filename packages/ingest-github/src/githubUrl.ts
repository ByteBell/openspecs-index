/**
 * Minimal GitHub REST helpers used by the pull flow.
 *
 * Public repo only models GitHub (no Bitbucket), so this stays small —
 * a URL parser and a single branch-head lookup. Both are best-effort:
 * `null` on parse failure or non-2xx so callers can fall back without
 * try/catch noise.
 *
 * SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
 */

export const USER_AGENT = "ByteBell";

export interface ParsedRepo {
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * Parses `https://<host>/{owner}/{repo}(/tree/{branch})?` → `{owner, repo, branch?}`.
 *
 * Host-agnostic: the path-segment logic works the same for github.com,
 * gitlab.com, bitbucket.org, and self-hosted forges. Enterprise wrappers
 * reuse this pipeline for non-GitHub providers via an injected SourceFactory;
 * gating on hostname would force every wrapper to invent a URL-substitution
 * dance just to satisfy the parser. The `/tree/{branch}` suffix is
 * GitHub-specific syntax — it remains opt-in (matches when present, ignored
 * when absent). GitLab/Bitbucket payloads carry `branch` as a separate field.
 */
export function parseGithubRepo(repoUrl: string): ParsedRepo | null {
  if (!repoUrl) {
    return null;
  }
  try {
    const url = new URL(repoUrl);
    const segments = url.pathname.split("/").filter((s) => s.length > 0);
    if (segments.length < 2) {
      return null;
    }
    const owner = segments[0];
    const repoRaw = segments[1];
    if (owner === undefined || repoRaw === undefined) {
      return null;
    }
    const repo = repoRaw.replace(/\.git$/u, "");
    const out: ParsedRepo = { owner, repo };

    // Support https://github.com/owner/repo/tree/branch-name
    if (segments[2] === "tree" && segments.length > 3) {
      out.branch = segments.slice(3).join("/");
    }

    return out;
  } catch {
    return null;
  }
}
