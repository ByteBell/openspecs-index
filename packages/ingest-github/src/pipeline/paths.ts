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
    unitAnalysisDir: path.join(metaRoot, "unit-analysis"),
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
  await mkdir(paths.unitAnalysisDir, { recursive: true, mode: DIR_MODE });
}

/**
 * Filesystem-safe encoding of a code unit's qualified name. Strips characters that are
 * problematic on case-insensitive or path-restricted filesystems and caps length at 80.
 */
export function safeUnitName(qualifiedName: string): string {
  return qualifiedName.replace(/[^A-Za-z0-9._-]+/gu, "_").slice(0, 80);
}

/** Absolute path of the per-file file-analysis record for a small file. */
export function fileAnalysisRecordPath(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.fileAnalysisDir, `${encodeMetaPath(relativePath)}.json`);
}

/** Absolute path of the boundaries record for one big file. */
export function bigFileBoundariesPath(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.bigFileAnalysisDir, `${encodeMetaPath(relativePath)}.boundaries.json`);
}

/** Per-file chunk directory holding every `chunk-N.*.json` for one big file. */
export function bigFileChunkDir(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.bigFileChunksDir, encodeMetaPath(relativePath));
}

/** Absolute path of one big-file raw chunk record (`chunk-N.raw.json`, 1-based). */
export function bigFileRawChunkPath(metaPaths: MetaPaths, relativePath: string, chunkNumber: number): string {
  return path.join(bigFileChunkDir(metaPaths, relativePath), `chunk-${String(chunkNumber)}.raw.json`);
}

/** Absolute path of one big-file analysed chunk record (`chunk-N.json`, 1-based). */
export function bigFileAnalysedChunkPath(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
): string {
  return path.join(bigFileChunkDir(metaPaths, relativePath), `chunk-${String(chunkNumber)}.json`);
}

/**
 * Per-file/per-chunk unit directory holding `<safeUnit>.source.json` /
 * `<safeUnit>.analysis.json`. `chunkNumber === null` for small files;
 * `chunkNumber >= 1` for big-file chunks (matches the chunk-N file-analysis record).
 */
export function unitDirFor(metaPaths: MetaPaths, relativePath: string, chunkNumber: number | null): string {
  const base = path.join(metaPaths.unitAnalysisDir, encodeMetaPath(relativePath));
  return chunkNumber === null ? base : path.join(base, `chunk-${String(chunkNumber)}`);
}

/** Absolute path of one unit's `<name>.source.json` record. */
export function unitSourceRecordPath(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
  qualifiedName: string,
): string {
  return path.join(unitDirFor(metaPaths, relativePath, chunkNumber), `${safeUnitName(qualifiedName)}.source.json`);
}

/** Absolute path of one unit's `<name>.analysis.json` record. */
export function unitAnalysisRecordPath(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
  qualifiedName: string,
): string {
  return path.join(unitDirFor(metaPaths, relativePath, chunkNumber), `${safeUnitName(qualifiedName)}.analysis.json`);
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
