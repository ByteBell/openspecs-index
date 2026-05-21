export enum KnowledgeState {
  Created = "CREATED",
  Queued = "QUEUED",
  Ingested = "INGESTED",
  Processing = "PROCESSING",
  Processed = "PROCESSED",
  Failed = "FAILED",
}

const FULL_COMMIT_HASH_RE = /^[0-9a-f]{40}$/iu;

export interface CommitHashRecord {
  hash: string;
  inputTokens?: string;
  outputTokens?: string;
  costUsd?: string;
}

export type CommitHashEntry = string | CommitHashRecord;

export interface GithubKnowledgeSource {
  kind: "github";
  repoUrl: string;
  branch?: string;
  /** Current indexed commit pointer. */
  commitId?: string;
  /** Every commit this knowledge has been indexed at, oldest to newest. Pull appends to this list. */
  commitHashes?: CommitHashEntry[];
}

export interface LocalKnowledgeSource {
  kind: "local";
  sourcePath: string;
}

export type KnowledgeSource = GithubKnowledgeSource | LocalKnowledgeSource;

export interface KnowledgeDoc {
  knowledgeId: string;
  source: KnowledgeSource;
  status: { state: KnowledgeState; totalFiles?: number; processedFiles?: number };
  createdAt: Date;
  updatedAt: Date;
}

export function isFullCommitHash(value: unknown): value is string {
  return typeof value === "string" && FULL_COMMIT_HASH_RE.test(value);
}

export function normalizeCommitHashes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const hash =
      typeof item === "string"
        ? item
        : typeof item === "object" && item !== null && typeof (item as { hash?: unknown }).hash === "string"
          ? (item as { hash: string }).hash
          : "";
    if (isFullCommitHash(hash)) {
      const normalized = hash.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        hashes.push(normalized);
      }
    }
  }
  return hashes;
}

export function resolveIndexedCommit(source: GithubKnowledgeSource): string | undefined {
  if (isFullCommitHash(source.commitId)) {
    return source.commitId.toLowerCase();
  }
  return normalizeCommitHashes(source.commitHashes).at(-1);
}
