import {
  bigFileChunk,
  bigFileChunkDir,
  bigFileManifest,
  codeUnitsFile,
  fileAnalysisFile,
  folderSummaryFile,
} from "./builders.ts";
import { encodeMetaPath } from "./encode.ts";
import { ensureMetaDirs, repoCommitMetaPathsFor } from "./meta-paths.ts";
import type { MetaPaths, MetaStorageLayout, RepoCommitIdentity } from "./types.ts";

/**
 * Binds a set of resolved root directories to the pure path builders, producing
 * the `MetaStorageLayout` every caller uses so consumers never re-derive
 * `path.join(dir, encode(rel))` themselves.
 */
function buildLayout(paths: MetaPaths): MetaStorageLayout {
  return {
    ...paths,
    encode: encodeMetaPath,
    fileAnalysisFile: (relativePath) => fileAnalysisFile(paths, relativePath),
    bigFileChunkDir: (relativePath) => bigFileChunkDir(paths, relativePath),
    bigFileChunk: (relativePath, chunkIndex) => bigFileChunk(paths, relativePath, chunkIndex),
    bigFileManifest: (relativePath) => bigFileManifest(paths, relativePath),
    folderSummaryFile: (folderPath) => folderSummaryFile(paths, folderPath),
    codeUnitsFile: (relativePath) => codeUnitsFile(paths, relativePath),
    ensureDirs: () => ensureMetaDirs(paths),
  };
}

/**
 * The per-commit storage layout, rooted at
 * `<base>/orgs/<orgId>/<provider>/<owner>/<repo>/<knowledgeId>/<commitHash>/`.
 * The single layout every ingestion strategy and the IR driver resolve through.
 */
export function createRepoCommitStorageLayout(id: RepoCommitIdentity): MetaStorageLayout {
  return buildLayout(repoCommitMetaPathsFor(id));
}
