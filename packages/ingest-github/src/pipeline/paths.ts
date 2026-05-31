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
