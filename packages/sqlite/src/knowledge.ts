import type { KnowledgeDoc, KnowledgeFailureCategory, KnowledgeState } from "@bb/types";
import { KnowledgeNotFoundError } from "@bb/errors";
import { getSqliteDb } from "./client.ts";

export interface KnowledgeListEntry extends KnowledgeDoc {
  fileCount: number;
}

export interface DeleteKnowledgeResult {
  knowledgeDeleted: number;
  rawDeleted: number;
}

export async function setKnowledgeState(knowledgeId: string, state: KnowledgeState): Promise<void> {
  const db = getSqliteDb();
  const now = new Date().toISOString();
  const result = db.run(
    "UPDATE knowledge SET value = json_remove(json_set(value, '$.status.state', ?, '$.updatedAt', ?), '$.failure') WHERE key = ?",
    [state, now, knowledgeId],
  );
  if (result.changes === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function markKnowledgeFailed(
  knowledgeId: string,
  reason: string,
  category: KnowledgeFailureCategory,
  detail?: string,
): Promise<void> {
  const db = getSqliteDb();
  const now = new Date().toISOString();
  const failure = {
    reason,
    category,
    at: now,
    detail: detail || undefined,
  };
  const result = db.run(
    "UPDATE knowledge SET value = json_set(value, '$.status.state', 'FAILED', '$.updatedAt', ?, '$.failure', json(?)) WHERE key = ?",
    [now, JSON.stringify(failure), knowledgeId],
  );
  if (result.changes === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function setKnowledgeCommit(
  knowledgeId: string,
  commitHash: string,
  inputTokens: string = "",
  outputTokens: string = "",
  costUsd: string = "0",
): Promise<void> {
  const db = getSqliteDb();
  const row = db.query("SELECT value FROM knowledge WHERE key = ?").get(knowledgeId) as {
    value: string;
  } | null;
  if (!row) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
  const doc = JSON.parse(row.value) as KnowledgeDoc;
  const source = doc.source as { commitId?: string; commitHashes?: unknown[] };
  source.commitId = commitHash;
  if (!source.commitHashes) {
    source.commitHashes = [];
  }
  const exists = source.commitHashes.some((c: unknown) =>
    typeof c === "string" ? c === commitHash : (c as { hash?: string }).hash === commitHash,
  );
  if (!exists) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source.commitHashes.push({ hash: commitHash, inputTokens, outputTokens, costUsd } as any);
  }
  doc.updatedAt = new Date();
  db.run("UPDATE knowledge SET value = ? WHERE key = ?", [JSON.stringify(doc), knowledgeId]);
}

/**
 * Sets `source.commitId` only — no history append. Used early in the
 * pipeline so MCP tools (`retrieve_file_content` etc.) called during
 * enrichment can resolve the on-disk clone dir via the commit-scoped path
 * layout. The history entry is written later by `setKnowledgeCommit`.
 */
export async function setKnowledgeCommitHead(knowledgeId: string, commitHash: string): Promise<void> {
  const db = getSqliteDb();
  const now = new Date().toISOString();
  const result = db.run(
    "UPDATE knowledge SET value = json_set(value, '$.source.commitId', ?, '$.updatedAt', ?) WHERE key = ?",
    [commitHash, now, knowledgeId],
  );
  if (result.changes === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function setKnowledgeBranch(knowledgeId: string, branch: string): Promise<void> {
  const db = getSqliteDb();
  const now = new Date().toISOString();
  const result = db.run(
    "UPDATE knowledge SET value = json_set(value, '$.source.branch', ?, '$.updatedAt', ?) WHERE key = ?",
    [branch, now, knowledgeId],
  );
  if (result.changes === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function updateKnowledgeProgress(
  knowledgeId: string,
  processedFiles: number,
  totalFiles?: number,
  extra?: { progressPercent?: number; currentPhase?: string },
): Promise<void> {
  const db = getSqliteDb();
  const now = new Date().toISOString();
  // Build the json_set assignments dynamically so optional fields are only
  // written when supplied — keeps file counts and phase metadata independent.
  const sets = ["'$.status.processedFiles', ?", "'$.updatedAt', ?"];
  const params: (string | number)[] = [processedFiles, now];
  if (totalFiles !== undefined) {
    sets.push("'$.status.totalFiles', ?");
    params.push(totalFiles);
  }
  if (extra?.progressPercent !== undefined) {
    sets.push("'$.status.progressPercent', ?");
    params.push(extra.progressPercent);
  }
  if (extra?.currentPhase !== undefined) {
    sets.push("'$.status.currentPhase', ?");
    params.push(extra.currentPhase);
  }
  params.push(knowledgeId);
  const result = db.run(`UPDATE knowledge SET value = json_set(value, ${sets.join(", ")}) WHERE key = ?`, params);
  if (result.changes === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function upsertKnowledge(doc: Omit<KnowledgeDoc, "updatedAt"> & { updatedAt?: Date }): Promise<void> {
  const now = new Date();
  const db = getSqliteDb();
  const finalDoc: KnowledgeDoc = {
    ...doc,
    updatedAt: doc.updatedAt ?? now,
  };
  db.run("INSERT INTO knowledge (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    doc.knowledgeId,
    JSON.stringify(finalDoc),
  ]);
}

export async function deleteKnowledge(knowledgeId: string): Promise<DeleteKnowledgeResult> {
  const db = getSqliteDb();
  const res1 = db.run("DELETE FROM knowledge WHERE key = ?", [knowledgeId]);
  if (res1.changes === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
  const res2 = db.run("DELETE FROM raw_files WHERE knowledgeId = ?", [knowledgeId]);
  return {
    knowledgeDeleted: res1.changes,
    rawDeleted: res2.changes,
  };
}

export async function listKnowledge(opts: { limit?: number } = {}): Promise<KnowledgeListEntry[]> {
  const db = getSqliteDb();
  const limit = opts.limit ?? 200;
  const rows = db
    .query("SELECT value FROM knowledge ORDER BY json_extract(value, '$.updatedAt') DESC LIMIT ?")
    .all(limit) as { value: string }[];

  const entries: KnowledgeListEntry[] = [];
  for (const row of rows) {
    const doc = JSON.parse(row.value) as KnowledgeDoc;
    const fileCountRow = db
      .query("SELECT COUNT(*) as count FROM raw_files WHERE knowledgeId = ?")
      .get(doc.knowledgeId) as { count: number };
    entries.push({
      ...doc,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
      fileCount: fileCountRow.count,
    });
  }
  return entries;
}

export async function getKnowledge(knowledgeId: string): Promise<KnowledgeListEntry | null> {
  const db = getSqliteDb();
  const row = db.query("SELECT value FROM knowledge WHERE key = ?").get(knowledgeId) as { value: string } | null;
  if (!row) {
    return null;
  }
  const doc = JSON.parse(row.value) as KnowledgeDoc;
  const fileCountRow = db.query("SELECT COUNT(*) as count FROM raw_files WHERE knowledgeId = ?").get(knowledgeId) as {
    count: number;
  };
  return {
    ...doc,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
    fileCount: fileCountRow.count,
  };
}
