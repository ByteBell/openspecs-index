import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getBytebellHome } from "@bb/config";
import type { RepoCommitIdentity } from "./types.ts";

const DIR_MODE = 0o700;

/**
 * The RAW storage base — `~/.bytebell` in OSS, or the enterprise resolver's
 * `$KNOWLEDGE_BASE_PATH`. This package (NOT the home resolver) owns the
 * `orgs/<orgId>` scoping below it, so org isolation is explicit in code and an
 * org's data is never split across roots.
 */
export function storageBase(): string {
  return getBytebellHome();
}

// ── Org scope (the top level) ────────────────────────────────────────────────

/** `<base>/orgs/<orgId>` — every artifact for one org lives under here. */
export function orgRoot(orgId: string): string {
  return path.join(storageBase(), "orgs", orgId);
}

export async function ensureOrgRoot(orgId: string): Promise<void> {
  await mkdir(orgRoot(orgId), { recursive: true, mode: DIR_MODE });
}

// ── Per-commit roots (the canonical repo layout) ─────────────────────────────

/**
 * Root for one repo at one commit:
 * `<base>/orgs/<orgId>/<provider>/<owner>/<repo>/<knowledgeId>/<commitHash>`.
 * Every artifact for that commit — and the checkout itself — lives beneath it,
 * so different commits of the same repo never collide.
 */
export function repoCommitRoot(id: RepoCommitIdentity): string {
  return path.join(orgRoot(id.orgId), id.provider, id.owner, id.repo, id.knowledgeId, id.commitHash);
}

/** The git checkout for one commit: `<repoCommitRoot>/repo`. */
export function repoCommitCloneDir(id: RepoCommitIdentity): string {
  return path.join(repoCommitRoot(id), "repo");
}

export async function ensureRepoCommitRoot(id: RepoCommitIdentity): Promise<void> {
  await mkdir(repoCommitRoot(id), { recursive: true, mode: DIR_MODE });
}

/**
 * A business-context analysis authored against this commit. Each context lives
 * at `business-context/<sanitizedTitle>/` and holds `original.txt` (raw user
 * text) and `analysis.json` (the LLM analysis in its metadata envelope).
 */
export function businessContextDir(id: RepoCommitIdentity, sanitizedTitle: string): string {
  return path.join(repoCommitRoot(id), "business-context", sanitizedTitle);
}

// ── Org-level keyword registry ───────────────────────────────────────────────

/**
 * Org-level keyword registry: `<base>/orgs/<orgId>/keyword-registry`. Aggregates
 * across the org's knowledges; the business-context enrichment reader tolerates
 * a missing directory.
 */
export function orgRegistryDir(orgId: string): string {
  return path.join(orgRoot(orgId), "keyword-registry");
}

// ── LLM response cache (shared by @bb/llm and @bytebell/llm) ──────────────────

/** Org-level cache root: `<base>/orgs/<orgId>/llm-cache`. */
export function llmCacheRoot(orgId: string): string {
  return path.join(orgRoot(orgId), "llm-cache");
}

/** `<root>/<2-char shard of key>` — the shard keeps any one dir's `readdir` bounded. */
export function llmCacheDirUnder(root: string, key: string): string {
  const shard = (key.slice(0, 2) || "__").padEnd(2, "_");
  return path.join(root, shard);
}

/** `<root>/<shard>/<key>.json`. Pass the resolved `root` (`llmCacheRoot(orgId)` or a config override). */
export function llmCacheEntryUnder(root: string, key: string): string {
  return path.join(llmCacheDirUnder(root, key), `${key}.json`);
}
