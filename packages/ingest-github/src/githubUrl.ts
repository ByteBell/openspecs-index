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
 * Parses `https://github.com/{owner}/{repo}(/tree/{branch})?` → `{owner, repo, branch?}`.
 *
 * Also accepts `gitlab.com` URLs of the form
 * `https://gitlab.com/{owner}/{repo}` so the runner can build a kube-v2
 * `RepoLocation` for GitLab knowledges that route through this pipeline via
 * an injected `SourceFactory`. The kernel `RepoLocation` only has a `github`
 * provider variant today, so GitLab projects share the github path segment.
 * Subgroup gitlab URLs (`group/sub/project`) collapse to `{ owner: group,
 * repo: sub }` here — downstream consumers that need the full namespace
 * should derive it themselves; the GitLab source-factory does this.
 */
export function parseGithubRepo(repoUrl: string): ParsedRepo | null {
  if (!repoUrl) {
    return null;
  }
  try {
    const url = new URL(repoUrl);
    if (!url.hostname.endsWith("github.com") && !url.hostname.endsWith("gitlab.com")) {
      return null;
    }
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
