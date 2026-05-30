/**
 * The on-disk storage layout contract for the whole ingestion engine.
 *
 * Every artifact a run writes — the git clone, per-file analyses, folder
 * summaries, big-file chunks and manifests, the repo summary, the scan
 * manifest, business-context analyses, and the LLM response cache — lives at a
 * path derived in THIS package. Nothing elsewhere may call `path.join` against
 * a storage root; if a new artifact needs a home, add its builder here.
 */

/**
 * Identity of one ingested repo at one commit — the ordered segments of its
 * org- and provider-scoped root:
 * `<base>/orgs/<orgId>/<provider>/<owner>/<repo>/<knowledgeId>/<commitHash>`.
 * `orgId` is the top scope so every artifact for one org (across all its repos
 * and commits) lives under a single `orgs/<orgId>/` directory. Used by every
 * per-commit path builder so analyses, code units, and the clone of different
 * commits of the same repo never share a directory.
 */
export interface RepoCommitIdentity {
  /** Tenant/org id; the top storage scope. Defaults to `"local"` in OSS. */
  orgId: string;
  /** Git host, e.g. `"github"`. */
  provider: string;
  /** Repo owner / username, e.g. `"Dead-Bytes"`. */
  owner: string;
  /** Repo name, e.g. `"kale-pool"`. */
  repo: string;
  /** The knowledge UUID/id this ingestion belongs to. */
  knowledgeId: string;
  /** The checked-out commit SHA. */
  commitHash: string;
}

/** Root directories of the meta store under one per-commit root. */
export interface MetaPaths {
  metaRoot: string;
  fileAnalysisDir: string;
  folderSummariesDir: string;
  bigFileAnalysisDir: string;
  bigFileChunksDir: string;
  /** IR-extracted code units (one record per unit) for this commit. */
  codeUnitsDir: string;
  bigFilesJson: string;
  scanManifestJson: string;
  repoSummaryJson: string;
}

/**
 * Resolver for every concrete artifact path under one meta root. Built by
 * `createMetaStorageLayout` / `createRepoCommitStorageLayout`. Extends
 * `MetaPaths` so the root directories stay directly accessible
 * (`layout.fileAnalysisDir`, …) for `readdir`-style listings that scan a whole
 * directory rather than encode one relative path.
 */
export interface MetaStorageLayout extends MetaPaths {
  /** Reversibly encodes a repo-relative path into a single flat filename segment. */
  encode(relativePath: string): string;
  /** `<fileAnalysisDir>/<encoded>.json` — one per small/condensed/reconstructed file. */
  fileAnalysisFile(relativePath: string): string;
  /** `<bigFileChunksDir>/<encoded>/` — directory holding one big file's chunk JSONs. */
  bigFileChunkDir(relativePath: string): string;
  /** `<bigFileChunkDir>/chunk-<index>.json`. */
  bigFileChunk(relativePath: string, chunkIndex: number): string;
  /** `<bigFileAnalysisDir>/<encoded>.manifest.json`. */
  bigFileManifest(relativePath: string): string;
  /** `<folderSummariesDir>/<encoded-or-__ROOT__>.json`. */
  folderSummaryFile(folderPath: string): string;
  /** `<codeUnitsDir>/<encoded>.json` — IR-extracted code units for one source file. */
  codeUnitsFile(relativePath: string): string;
  /** Creates every meta directory (idempotent). */
  ensureDirs(): Promise<void>;
}
