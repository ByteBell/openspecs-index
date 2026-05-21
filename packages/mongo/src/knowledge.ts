import {
  KnowledgeState,
  isFullCommitHash,
  normalizeCommitHashes,
  type KnowledgeDoc,
  type KnowledgeSource,
} from "@bb/types";
import { KnowledgeNotFoundError } from "@bb/errors";
import { _getDb } from "./client.ts";
import { Collections } from "./collections.ts";

const DEFAULT_LIST_LIMIT = 200;

export interface KnowledgeListEntry extends KnowledgeDoc {
  fileCount: number;
}

export async function setKnowledgeState(knowledgeId: string, state: KnowledgeState): Promise<void> {
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne({ knowledgeId }, { $set: { "status.state": state, updatedAt: new Date() } });
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

/**
 * Records that this knowledge is now indexed at `commitHash`. Sets it as the
 * current indexed commit pointer (`source.commitId`) and appends to the deduped history
 * array (`source.commitHashes`). Idempotent: re-recording the same commit is
 * a no-op except for the `updatedAt` bump.
 *
 * Throws `KnowledgeNotFoundError` if the document doesn't exist.
 */
export async function setKnowledgeCommit(knowledgeId: string, commitHash: string): Promise<void> {
  if (!isFullCommitHash(commitHash)) {
    throw new Error(`invalid commit hash for knowledge ${knowledgeId}: ${commitHash}`);
  }
  const normalizedCommitHash = commitHash.toLowerCase();
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne(
      { knowledgeId },
      {
        $set: { "source.commitId": normalizedCommitHash, updatedAt: new Date() },
        $addToSet: { "source.commitHashes": normalizedCommitHash },
      },
    );
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function updateKnowledgeProgress(
  knowledgeId: string,
  processedFiles: number,
  totalFiles?: number,
): Promise<void> {
  const update: Record<string, number | Date> = {
    "status.processedFiles": processedFiles,
    updatedAt: new Date(),
  };
  if (totalFiles !== undefined) {
    update["status.totalFiles"] = totalFiles;
  }
  const result = await _getDb().collection(Collections.Knowledge).updateOne({ knowledgeId }, { $set: update });
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

export async function upsertKnowledge(doc: Omit<KnowledgeDoc, "updatedAt"> & { updatedAt?: Date }): Promise<void> {
  const now = new Date();
  const source = normalizeKnowledgeSourceForWrite(doc.knowledgeId, doc.source);
  await _getDb()
    .collection(Collections.Knowledge)
    .updateOne(
      { knowledgeId: doc.knowledgeId },
      {
        $set: {
          source,
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

function normalizeKnowledgeSourceForWrite(knowledgeId: string, source: KnowledgeSource): KnowledgeSource {
  if (source.kind !== "github") {
    return source;
  }
  if (source.commitId !== undefined && !isFullCommitHash(source.commitId)) {
    throw new Error(`invalid commit hash for knowledge ${knowledgeId}: ${source.commitId}`);
  }
  const commitHashes = normalizeCommitHashes(source.commitHashes);
  return {
    kind: "github",
    repoUrl: source.repoUrl,
    ...(source.branch !== undefined ? { branch: source.branch } : {}),
    ...(source.commitId !== undefined ? { commitId: source.commitId.toLowerCase() } : {}),
    ...(commitHashes.length > 0 ? { commitHashes } : {}),
  };
}

export interface DeleteKnowledgeResult {
  knowledgeDeleted: number;
  rawDeleted: number;
  statsDeleted: number;
}

export async function deleteKnowledge(knowledgeId: string): Promise<DeleteKnowledgeResult> {
  const db = _getDb();
  const knowledgeRes = await db.collection(Collections.Knowledge).deleteOne({ knowledgeId });
  if (knowledgeRes.deletedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
  const rawRes = await db.collection(Collections.Raw).deleteMany({ knowledgeId });
  const statsRes = await db.collection(Collections.ProcessingStats).deleteMany({ knowledgeId });
  return {
    knowledgeDeleted: knowledgeRes.deletedCount ?? 0,
    rawDeleted: rawRes.deletedCount ?? 0,
    statsDeleted: statsRes.deletedCount ?? 0,
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
