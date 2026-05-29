import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Pure-typed on-disk path resolver shared across packages that need to read
// or write knowledge artifacts. No I/O, no FS calls — every helper returns
// strings derived from the inputs. Callers compose with their own
// `getBytebellHome()` (the package boundary that holds the home-dir state).
//
// Layout (per knowledge + provider + commit):
//   `<home>/<provider>/<knowledgeId>/<owner>/<repo>/<commit>/repository/`
//   `<home>/<provider>/<knowledgeId>/<owner>/<repo>/<commit>/meta-output/`
// For local sources the `<owner>/<repo>` segments collapse:
//   `<home>/local/<knowledgeId>/<commit>/repository/`
//
// `<home>` is the per-tenant base directory:
//   • OSS standalone: `~/.bytebell/` (single-tenant; no org segment)
//   • Enterprise: `<KNOWLEDGE_BASE_PATH>/orgs/<orgName>/` (via the
//     `setBytebellHomeResolver` override in `seed-oss-config.ts`)
//
// The resolver deliberately stays org-agnostic. The org segment lives in
// `<home>` when the host requires per-tenant isolation — adding it again
// here would duplicate it for enterprise consumers.
//
// See `@bb/ingest-github/src/pipeline/paths.ts` for the I/O-aware wrappers
// that pair with this module.
// ─────────────────────────────────────────────────────────────────────────────

export type RepoLocation =
  | {
      provider: "github";
      orgId: string;
      knowledgeId: string;
      owner: string;
      repo: string;
      commitHash: string;
    }
  | {
      provider: "local";
      orgId: string;
      knowledgeId: string;
      commitHash: string;
    };

/**
 * Same `MetaPaths` shape that `@bb/ingest-github` exposes — duplicated here
 * so kernel-tier consumers can describe the surface without taking a Domain
 * dependency. Field semantics: see `@bb/ingest-github/types/meta-paths.ts`.
 */
export interface MetaPathsLayout {
  repositoryDir: string;
  metaOutputRoot: string;
  metaRoot: string;
  fileAnalysisDir: string;
  folderSummariesDir: string;
  bigFileAnalysisDir: string;
  bigFileChunksDir: string;
  bigFilesJson: string;
  scanManifestJson: string;
  repoSummaryJson: string;
}

/**
 * Deprecated. Kept as a back-compat shim for the migration tool, which
 * describes the legacy layout `<home>/orgs/<orgId>/…`. The active layout
 * no longer adds an `orgs/` segment here — that responsibility moved into
 * `<home>` itself (enterprise's `getBytebellHome` resolver returns a
 * per-tenant `<base>/orgs/<orgName>/`).
 */
export function orgsRootFor(home: string): string {
  return path.join(home, "orgs");
}

export function commitBaseDirFor(home: string, loc: RepoLocation): string {
  if (loc.provider === "github") {
    return path.join(home, "github", loc.knowledgeId, loc.owner, loc.repo, loc.commitHash);
  }
  return path.join(home, "local", loc.knowledgeId, loc.commitHash);
}

export function repositoryDirFor(home: string, loc: RepoLocation): string {
  return path.join(commitBaseDirFor(home, loc), "repository");
}

export function metaOutputRootFor(home: string, loc: RepoLocation): string {
  return path.join(commitBaseDirFor(home, loc), "meta-output");
}

export function bytebellPathsFor(home: string, loc: RepoLocation): MetaPathsLayout {
  const meta = metaOutputRootFor(home, loc);
  return {
    repositoryDir: repositoryDirFor(home, loc),
    metaOutputRoot: meta,
    metaRoot: meta,
    fileAnalysisDir: path.join(meta, "file-analysis"),
    folderSummariesDir: path.join(meta, "folder-summaries"),
    bigFileAnalysisDir: path.join(meta, "big-file-analysis"),
    bigFileChunksDir: path.join(meta, "big-file-analysis", "chunks"),
    bigFilesJson: path.join(meta, "bigFiles.json"),
    scanManifestJson: path.join(meta, "scan-manifest.json"),
    repoSummaryJson: path.join(meta, "repo-summary.json"),
  };
}

/**
 * Pure URL parser for GitHub repo URLs. Extracts owner and repo segments,
 * tolerating `.git` suffixes and `tree/branch` paths. Returns `null` on any
 * input that isn't a GitHub-hosted URL.
 *
 * Duplicates the public `parseGithubRepo` from `@bb/ingest-github/githubUrl`
 * deliberately — kernel-tier code can't import from Domain. The two
 * implementations must stay consistent; both are tiny and pure.
 */
export function parseGithubOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  if (repoUrl.length === 0) {
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
    return { owner, repo: repoRaw.replace(/\.git$/u, "") };
  } catch {
    return null;
  }
}
