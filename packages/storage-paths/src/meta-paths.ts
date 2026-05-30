import { mkdir } from "node:fs/promises";
import path from "node:path";
import { repoCommitRoot } from "./roots.ts";
import type { MetaPaths, RepoCommitIdentity } from "./types.ts";

const DIR_MODE = 0o700;

/**
 * Builds the artifact directories under a per-commit `metaRoot`. The directory
 * NAMES are fixed, so every commit lays out identically below its own root.
 */
export function metaPathsUnder(metaRoot: string): MetaPaths {
  return {
    metaRoot,
    fileAnalysisDir: path.join(metaRoot, "file-analysis"),
    folderSummariesDir: path.join(metaRoot, "folder-summaries"),
    bigFileAnalysisDir: path.join(metaRoot, "big-file-analysis"),
    bigFileChunksDir: path.join(metaRoot, "big-file-analysis", "chunks"),
    codeUnitsDir: path.join(metaRoot, "code-units"),
    bigFilesJson: path.join(metaRoot, "bigFiles.json"),
    scanManifestJson: path.join(metaRoot, "scan-manifest.json"),
    repoSummaryJson: path.join(metaRoot, "repo-summary.json"),
  };
}

/** The per-commit meta paths for one repo at one commit. */
export function repoCommitMetaPathsFor(id: RepoCommitIdentity): MetaPaths {
  return metaPathsUnder(repoCommitRoot(id));
}

/** Creates every meta directory (idempotent). The `repo/` clone dir is created by the cloner. */
export async function ensureMetaDirs(paths: MetaPaths): Promise<void> {
  await mkdir(paths.fileAnalysisDir, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.folderSummariesDir, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.bigFileAnalysisDir, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.bigFileChunksDir, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.codeUnitsDir, { recursive: true, mode: DIR_MODE });
}
