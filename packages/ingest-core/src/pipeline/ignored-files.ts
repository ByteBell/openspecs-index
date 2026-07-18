// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
/**
 * Records the files the scan skipped, and why, into the `ignored_files` Mongo collection.
 *
 * The scan drops ignored files silently — they never reach the manifest or the graph — so there is
 * no downstream trace of what was excluded or on what grounds. This module keeps that audit trail:
 * as the walk rejects a file it calls one of the semantic `record*` methods on an `IgnoreSink`, and
 * the whole batch is flushed to Mongo in a single `bulkWrite` when the scan finishes.
 *
 * The connection comes from `@bb/mongo` (`getMongoDb`); the collection shape and write logic live
 * here, in the scan package, since ingest-core owns "what a skipped file means". Classification of a
 * static reject into its precise rule (dir / filename / extension / glob) is delegated to
 * `classifyStaticIgnore` so the walkers stay declarative.
 */
import { getMongoDb } from "@bb/mongo";
import { logger } from "@bb/logger";
import {
  classifyStaticIgnore,
  type EffectiveIgnoreSets,
  type StaticIgnoreReason,
} from "./skip-decisions/effective.ts";

/**
 * Why the scan skipped a file, granular per rule. Static reasons mirror `StaticIgnoreReason`;
 * `binary` is the null-byte sniff; `llm` is a reject (or unresolved verdict) from the content
 * admission gate.
 */
export type IgnoreReason = StaticIgnoreReason | "binary" | "llm";

/** MongoDB collection holding one document per skipped file; identity is the unique (knowledgeId, filePath) index. */
export const IGNORED_FILES_COLLECTION = "ignored_files";

/** Identity of the ingest run a batch of skipped files belongs to. */
export interface IgnoredFilesTarget {
  knowledgeId: string;
  orgId: string;
  commitHash: string;
}

/**
 * The audit hook the scan walkers call at each skip site. `recordStatic` resolves the precise
 * static rule internally; the other methods carry a fixed reason. `flush` persists the batch and
 * clears it (safe to call more than once).
 */
export interface IgnoreSink {
  recordDir(relativePath: string): void;
  recordStatic(relativePath: string, ext: string): void;
  recordBinary(relativePath: string): void;
  recordLlm(relativePath: string): void;
  flush(): Promise<void>;
}

const NOOP_SINK: IgnoreSink = {
  recordDir: () => {},
  recordStatic: () => {},
  recordBinary: () => {},
  recordLlm: () => {},
  flush: async () => {},
};

interface IgnoredRecord {
  relativePath: string;
  reason: IgnoreReason;
}

/**
 * Build a sink bound to one ingest run. Returns a no-op sink when the run identity is incomplete
 * (OSS standalone, tests, or a caller that did not thread ids) so the scan stays side-effect-free
 * there — the ignore itself is authoritative; this collection is only an audit trail.
 */
export function makeIgnoreSink(target: IgnoredFilesTarget | undefined, sets: EffectiveIgnoreSets): IgnoreSink {
  if (target === undefined || target.knowledgeId.length === 0 || target.orgId.length === 0) {
    return NOOP_SINK;
  }
  const records: IgnoredRecord[] = [];
  const add = (relativePath: string, reason: IgnoreReason): void => {
    records.push({ relativePath, reason });
  };
  return {
    recordDir: (relativePath) => add(relativePath, "ignore_dir"),
    recordBinary: (relativePath) => add(relativePath, "binary"),
    recordLlm: (relativePath) => add(relativePath, "llm"),
    recordStatic: (relativePath, ext) => add(relativePath, classifyStaticIgnore(relativePath, ext, sets) ?? "ignore_extension"),
    flush: () => flushRecords(target, records),
  };
}

/** LLM verdict vs a hardcoded rule — echoes the provenance the skip-decision cache keeps. */
function sourceFor(reason: IgnoreReason): "hardcoded" | "llm" {
  return reason === "llm" ? "llm" : "hardcoded";
}

const msgOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * Memoized ensure of the unique `(knowledgeId, filePath)` index — the collection's identity, so a
 * re-index upserts in place and a duplicate can never be inserted. Created lazily on first write
 * (idempotent server-side). On failure the memo is reset so a later scan retries; a missing index
 * does not corrupt data because the upsert filter already keys on the same fields.
 */
let ignoredIndexReady: Promise<unknown> | null = null;
function ensureIgnoredFilesIndex(): Promise<unknown> {
  if (ignoredIndexReady === null) {
    ignoredIndexReady = getMongoDb()
      .collection(IGNORED_FILES_COLLECTION)
      .createIndex({ knowledgeId: 1, filePath: 1 }, { unique: true, name: "uniq_ignored_knowledge_file" })
      .catch((cause: unknown) => {
        ignoredIndexReady = null;
        logger.warn(`scan: failed to ensure ignored_files unique index: ${msgOf(cause)}`);
      });
  }
  return ignoredIndexReady;
}

/**
 * Upsert one document per skipped file in a single `bulkWrite`, keyed on the unique
 * `(knowledgeId, filePath)` index so a re-index overwrites rather than duplicates (`orgId` is stored
 * but redundant in the key — `knowledgeId` is a globally unique UUID). Fail-open: a Mongo error must
 * never abort the scan.
 */
async function flushRecords(target: IgnoredFilesTarget, records: IgnoredRecord[]): Promise<void> {
  if (records.length === 0) {
    return;
  }
  try {
    await ensureIgnoredFilesIndex();
    const updatedAt = new Date();
    const ops = records.map((r) => ({
      updateOne: {
        filter: { knowledgeId: target.knowledgeId, filePath: r.relativePath },
        update: {
          $set: {
            orgId: target.orgId,
            knowledgeId: target.knowledgeId,
            filePath: r.relativePath,
            reason: r.reason,
            source: sourceFor(r.reason),
            commitHash: target.commitHash,
            updatedAt,
          },
        },
        upsert: true,
      },
    }));
    await getMongoDb().collection(IGNORED_FILES_COLLECTION).bulkWrite(ops, { ordered: false });
    logger.info(`scan: recorded ${ops.length} ignored files (knowledge=${target.knowledgeId})`);
  } catch (cause: unknown) {
    logger.warn(`scan: failed to persist ignored_files (knowledge=${target.knowledgeId}): ${msgOf(cause)}`);
  } finally {
    records.length = 0;
  }
}
