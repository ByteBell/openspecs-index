import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getBytebellHome } from "@bb/config";
import type { MetaPaths } from "#src/types/meta-paths.ts";

const DIR_MODE = 0o700;

export function reposRoot(): string {
  return path.join(getBytebellHome(), "repos");
}

export function repoCloneDir(knowledgeId: string): string {
  return path.join(reposRoot(), knowledgeId);
}

export async function ensureReposRoot(): Promise<void> {
  await mkdir(reposRoot(), { recursive: true, mode: DIR_MODE });
}

export function metaRootFor(knowledgeId: string): string {
  return path.join(reposRoot(), ".meta", knowledgeId);
}

export function metaPathsFor(knowledgeId: string): MetaPaths {
  const metaRoot = metaRootFor(knowledgeId);
  return {
    metaRoot,
    fileAnalysisDir: path.join(metaRoot, "file-analysis"),
    folderSummariesDir: path.join(metaRoot, "folder-summaries"),
    bigFileAnalysisDir: path.join(metaRoot, "big-file-analysis"),
    bigFileChunksDir: path.join(metaRoot, "big-file-analysis", "chunks"),
    mcpEnrichmentDir: path.join(metaRoot, "mcp-enrichment"),
    bigFilesJson: path.join(metaRoot, "bigFiles.json"),
    scanManifestJson: path.join(metaRoot, "scan-manifest.json"),
    repoSummaryJson: path.join(metaRoot, "repo-summary.json"),
  };
}

/**
 * Per-commit meta directory for content scoped to a specific indexed commit.
 * Sits under the knowledge's `metaRoot/commits/<commitHash>/` so it survives
 * subsequent pulls that overwrite the live `:File` set.
 */
export function commitMetaDir(knowledgeId: string, commitHash: string): string {
  return path.join(metaRootFor(knowledgeId), "commits", commitHash);
}

/**
 * Directory for business-context analyses authored against a specific commit.
 * Each business context lives at `business-context/<sanitizedTitle>/` and contains
 * `original.txt` (the raw user-authored text) and `analysis.json` (the LLM
 * analysis wrapped in its metadata envelope).
 */
export function businessContextDir(knowledgeId: string, commitHash: string, sanitizedTitle: string): string {
  return path.join(commitMetaDir(knowledgeId, commitHash), "business-context", sanitizedTitle);
}

/**
 * Org-level keyword registry directory. In single-tenant OSS this resolves to
 * `metaRoot/org/<orgId>/` (orgId defaults to `"local"`); downstream multi-tenant
 * deployments may aggregate registries across multiple knowledges into the same
 * directory. The business-context enrichment reader tolerates missing files.
 */
export function orgRegistryDir(knowledgeId: string, orgId: string): string {
  return path.join(metaRootFor(knowledgeId), "org", orgId);
}

export async function ensureMetaDirs(paths: MetaPaths): Promise<void> {
  await mkdir(paths.fileAnalysisDir, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.folderSummariesDir, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.bigFileAnalysisDir, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.bigFileChunksDir, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.mcpEnrichmentDir, { recursive: true, mode: DIR_MODE });
}

/**
 * Filesystem-safe encoding of a code unit's qualified name. Strips characters that are
 * problematic on case-insensitive or path-restricted filesystems and caps length at 80.
 */
export function safeUnitName(qualifiedName: string): string {
  return qualifiedName.replace(/[^A-Za-z0-9._-]+/gu, "_").slice(0, 80);
}

/** Per-file directory under `fileAnalysisDir` owning everything about one small file. */
export function fileDirFor(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.fileAnalysisDir, encodeMetaPath(relativePath));
}

/** Per-file directory under `bigFileAnalysisDir` owning everything about one big file. */
export function bigFileDirFor(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.bigFileAnalysisDir, encodeMetaPath(relativePath));
}

/** Absolute path of the per-file file-analysis record for a small file (`<fileDir>/analysis.json`). */
export function fileAnalysisRecordPath(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(fileDirFor(metaPaths, relativePath), "analysis.json");
}

/** Absolute path of the boundaries record for one big file (`<bigFileDir>/boundaries.json`). */
export function bigFileBoundariesPath(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(bigFileDirFor(metaPaths, relativePath), "boundaries.json");
}

/** Per-file chunks directory holding every `chunk-N/` for one big file. */
export function bigFileChunkDir(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(bigFileDirFor(metaPaths, relativePath), "chunks");
}

/** Per-chunk directory `<bigFileDir>/chunks/chunk-N/`. */
export function chunkDirFor(metaPaths: MetaPaths, relativePath: string, chunkNumber: number): string {
  return path.join(bigFileChunkDir(metaPaths, relativePath), `chunk-${String(chunkNumber)}`);
}

/** Absolute path of one big-file raw chunk record (`<chunkDir>/raw.json`, 1-based N). */
export function bigFileRawChunkPath(metaPaths: MetaPaths, relativePath: string, chunkNumber: number): string {
  return path.join(chunkDirFor(metaPaths, relativePath, chunkNumber), "raw.json");
}

/** Absolute path of one big-file analysed chunk record (`<chunkDir>/analysis.json`, 1-based N). */
export function bigFileAnalysedChunkPath(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
): string {
  return path.join(chunkDirFor(metaPaths, relativePath, chunkNumber), "analysis.json");
}

/**
 * Per-file/per-chunk codeUnits directory holding `<safeUnit>.source.json` /
 * `<safeUnit>.analysis.json`.
 *
 * - Small file (`chunkNumber === null`): `<fileAnalysisDir>/<encoded>/codeUnits/`
 * - Big-file chunk (`chunkNumber >= 1`): `<bigFileAnalysisDir>/<encoded>/chunks/chunk-<N>/codeUnits/`
 */
export function unitDirFor(metaPaths: MetaPaths, relativePath: string, chunkNumber: number | null): string {
  if (chunkNumber === null) {
    return path.join(fileDirFor(metaPaths, relativePath), "codeUnits");
  }
  return path.join(chunkDirFor(metaPaths, relativePath, chunkNumber), "codeUnits");
}

/** Absolute path of one unit's `<name>.source.json` record (phase 6). */
export function unitSourceRecordPath(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
  qualifiedName: string,
): string {
  return path.join(unitDirFor(metaPaths, relativePath, chunkNumber), `${safeUnitName(qualifiedName)}.source.json`);
}

/** Absolute path of one unit's `<name>.analysis.json` record (phase 7). */
export function unitAnalysisRecordPath(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
  qualifiedName: string,
): string {
  return path.join(unitDirFor(metaPaths, relativePath, chunkNumber), `${safeUnitName(qualifiedName)}.analysis.json`);
}

/** Per-folder directory under `metaRoot/folder-specs/` keyed by the encoded folder path. */
export function folderSpecDir(metaPaths: MetaPaths, folderPath: string): string {
  const encoded = folderPath.length === 0 ? "__ROOT__" : encodeMetaPath(folderPath);
  return path.join(metaPaths.metaRoot, "folder-specs", encoded);
}

/** Absolute path of the FolderSpec record for one folder (`<folderSpecDir>/spec.json`). */
export function folderSpecRecordPath(metaPaths: MetaPaths, folderPath: string): string {
  return path.join(folderSpecDir(metaPaths, folderPath), "spec.json");
}

const SLASH_RE = /\//gu;
const BACKSLASH_RE = /\\/gu;
const ENCODED_SLASH_RE = /__SL__/gu;
const ENCODED_BACKSLASH_RE = /__BS__/gu;

export function encodeMetaPath(relativePath: string): string {
  return relativePath.replace(SLASH_RE, "__SL__").replace(BACKSLASH_RE, "__BS__");
}

export function decodeMetaPath(encoded: string): string {
  return encoded.replace(ENCODED_SLASH_RE, "/").replace(ENCODED_BACKSLASH_RE, "\\");
}
