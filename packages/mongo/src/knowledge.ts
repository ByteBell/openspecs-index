import type { KnowledgeDoc, KnowledgeState } from "@bb/types";
import { KnowledgeNotFoundError } from "@bb/errors";
import { _getDb } from "./client.ts";
import { Collections } from "./collections.ts";

const DEFAULT_LIST_LIMIT = 200;

export interface KnowledgeListEntry extends KnowledgeDoc {
  fileCount: number;
}

export async function setKnowledgeState(knowledgeId: string, state: KnowledgeState): Promise<void> {
  const update: Record<string, unknown> = { "status.state": state, updatedAt: new Date() };
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne({ knowledgeId }, { $set: update, $unset: { failure: "" } });
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

/**
 * Records that this knowledge is now indexed at `commitHash`. Sets it as the
 * current head pointer (`source.commitId`) and appends to the deduped history
 * array (`source.commitHashes`). Idempotent: re-recording the same commit is
 * a no-op except for the `updatedAt` bump.
 *
 * Throws `KnowledgeNotFoundError` if the document doesn't exist.
 */
export async function setKnowledgeCommit(
  knowledgeId: string,
  commitHash: string,
  inputTokens: string = "",
  outputTokens: string = "",
  costUsd: string = "0",
  cachedInputTokens: string = "0",
  cachedOutputTokens: string = "0",
  cachedCostUsd: string = "0",
): Promise<void> {
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne(
      { knowledgeId },
      {
        $set: { "source.commitId": commitHash, updatedAt: new Date() },
        $addToSet: {
          "source.commitHashes": {
            hash: commitHash,
            inputTokens,
            outputTokens,
            costUsd,
            cachedInputTokens,
            cachedOutputTokens,
            cachedCostUsd,
          },
        },
      },
    );
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

/**
 * Sets `source.commitId` only — no history append. Used early in the
 * pipeline so MCP tools (`retrieve_file_content` etc.) called during
 * enrichment can resolve the on-disk clone dir via the commit-scoped path
 * layout. The history entry is written later by `setKnowledgeCommit` with
 * the real token usage.
 */
export async function setKnowledgeCommitHead(knowledgeId: string, commitHash: string): Promise<void> {
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne({ knowledgeId }, { $set: { "source.commitId": commitHash, updatedAt: new Date() } });
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

/**
 * Updates the branch name of a GitHub knowledge entry.
 */
export async function setKnowledgeBranch(knowledgeId: string, branch: string): Promise<void> {
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne({ knowledgeId }, { $set: { "source.branch": branch, updatedAt: new Date() } });
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function updateKnowledgeProgress(
  knowledgeId: string,
  processedFiles: number,
  totalFiles?: number,
  extra?: { progressPercent?: number; currentPhase?: string },
): Promise<void> {
  const update: Record<string, number | string | Date> = {
    "status.processedFiles": processedFiles,
    updatedAt: new Date(),
  };
  if (totalFiles !== undefined) {
    update["status.totalFiles"] = totalFiles;
  }
  if (extra?.progressPercent !== undefined) {
    update["status.progressPercent"] = extra.progressPercent;
  }
  if (extra?.currentPhase !== undefined) {
    update["status.currentPhase"] = extra.currentPhase;
  }
  const result = await _getDb().collection(Collections.Knowledge).updateOne({ knowledgeId }, { $set: update });
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function upsertKnowledge(doc: Omit<KnowledgeDoc, "updatedAt"> & { updatedAt?: Date }): Promise<void> {
  const now = new Date();
  await _getDb()
    .collection(Collections.Knowledge)
    .updateOne(
      { knowledgeId: doc.knowledgeId },
      {
        $set: {
          source: doc.source,
          // `info` carries repoUrl/branch (set at index time). It MUST be
          // persisted — `GET /api/v1/repos` derives `source.repoUrl` from
          // `info.repoUrl`, and the CLI groups the `ls` view by it. Omitting it
          // here (as before) left Mongo entries with no repoUrl, so `ls` rendered
          // the group label as "undefined". The SQLite provider never had this
          // bug because it stores the whole doc as JSON.
          info: doc.info,
          status: doc.status,
          updatedAt: doc.updatedAt ?? now,
        },
        $setOnInsert: {
          knowledgeId: doc.knowledgeId,
          createdAt: doc.createdAt,
        },
      },
      { upsert: true },
    );
}

export interface DeleteKnowledgeResult {
  knowledgeDeleted: number;
  rawDeleted: number;
}

export async function deleteKnowledge(knowledgeId: string): Promise<DeleteKnowledgeResult> {
  const db = _getDb();
  const knowledgeRes = await db.collection(Collections.Knowledge).deleteOne({ knowledgeId });
  if (knowledgeRes.deletedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
  const rawRes = await db.collection(Collections.Raw).deleteMany({ knowledgeId });
  return {
    knowledgeDeleted: knowledgeRes.deletedCount ?? 0,
    rawDeleted: rawRes.deletedCount ?? 0,
  };
}

export async function listKnowledge(opts: { limit?: number } = {}): Promise<KnowledgeListEntry[]> {
  const db = _getDb();
  const limit = opts.limit ?? DEFAULT_LIST_LIMIT;
  const docs = (await db
    .collection(Collections.Knowledge)
    .find({})
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray()) as unknown as KnowledgeDoc[];

  const entries: KnowledgeListEntry[] = [];
  for (const doc of docs) {
    const fileCount = await db.collection(Collections.Raw).countDocuments({ knowledgeId: doc.knowledgeId });
    entries.push({ ...doc, fileCount });
  }
  return entries;
}
export async function getKnowledge(knowledgeId: string): Promise<KnowledgeListEntry | null> {
  const db = _getDb();
  const doc = (await db.collection(Collections.Knowledge).findOne({ knowledgeId })) as unknown as KnowledgeDoc | null;
  if (doc === null) {
    return null;
  }
  const fileCount = await db.collection(Collections.Raw).countDocuments({ knowledgeId });
  return { ...doc, fileCount };
}
