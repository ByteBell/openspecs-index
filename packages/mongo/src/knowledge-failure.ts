import type { KnowledgeFailureCategory } from "@bb/types";
import { KnowledgeNotFoundError } from "@bb/errors";
import { _getDb } from "./client.ts";
import { Collections } from "./collections.ts";

/**
 * Knowledge failure lifecycle: the terminal/transient state transitions that
 * stamp a structured `failure` subdoc. Split out of `knowledge.ts` to keep each
 * file single-responsibility (and under the 300-line ceiling). The next
 * successful state transition clears `failure` (see `setKnowledgeState`'s
 * `$unset` in `knowledge.ts`).
 */

function buildFailureSubdoc(
  reason: string,
  category: KnowledgeFailureCategory,
  at: Date,
  detail?: string,
): { reason: string; category: KnowledgeFailureCategory; at: Date; detail?: string } {
  const failure: { reason: string; category: KnowledgeFailureCategory; at: Date; detail?: string } = {
    reason,
    category,
    at,
  };
  if (detail !== undefined && detail.length > 0) {
    failure.detail = detail;
  }
  return failure;
}

/**
 * Marks a knowledge as FAILED and records the structured failure reason on
 * the top-level `failure` subdoc. The next successful transition out of
 * FAILED automatically clears it (see `setKnowledgeState`'s `$unset`).
 *
 * `reason` is a short operator-readable sentence (UI surfaces it directly).
 * `detail` is the raw provider response or structured debug payload (UI may
 * hide behind a disclosure).
 */
export async function markKnowledgeFailed(
  knowledgeId: string,
  reason: string,
  category: KnowledgeFailureCategory,
  detail?: string,
): Promise<void> {
  const now = new Date();
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne(
      { knowledgeId },
      {
        $set: {
          "status.state": "FAILED",
          failure: buildFailureSubdoc(reason, category, now, detail),
          updatedAt: now,
        },
      },
    );
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

/**
 * Marks a knowledge as HALTED — a transient failure for which auto-retry is
 * pending. Records the same structured `failure` subdoc as `markKnowledgeFailed`
 * so the reason is already persisted when the queue finalizer later promotes
 * HALTED → FAILED via `promoteHaltedToFailed`. HALTED is non-terminal: the next
 * successful transition clears `failure` (see `setKnowledgeState`'s `$unset`).
 */
export async function markKnowledgeHalted(
  knowledgeId: string,
  reason: string,
  category: KnowledgeFailureCategory,
  detail?: string,
): Promise<void> {
  const now = new Date();
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne(
      { knowledgeId },
      {
        $set: {
          "status.state": "HALTED",
          failure: buildFailureSubdoc(reason, category, now, detail),
          updatedAt: now,
        },
      },
    );
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

/**
 * Marks a knowledge as terminal CORRUPTED — the source repo is gone or
 * inaccessible. Records the same structured `failure` subdoc as
 * `markKnowledgeFailed`. CORRUPTED removes the row from the auto-pull sweep
 * (which selects only PROCESSED) while leaving the indexed data queryable. The
 * next successful transition clears `failure` (see `setKnowledgeState`'s `$unset`).
 */
export async function markKnowledgeCorrupted(
  knowledgeId: string,
  reason: string,
  category: KnowledgeFailureCategory,
  detail?: string,
): Promise<void> {
  const now = new Date();
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne(
      { knowledgeId },
      {
        $set: {
          "status.state": "CORRUPTED",
          failure: buildFailureSubdoc(reason, category, now, detail),
          updatedAt: now,
        },
      },
    );
  if (result.matchedCount === 0) {
    throw new KnowledgeNotFoundError(knowledgeId);
  }
}

/**
 * Promotes a HALTED knowledge to terminal FAILED, preserving the `failure`
 * subdoc recorded at HALT time (the original transient reason is more useful
 * than a generic "retries exhausted"). Scoped to `status.state === "HALTED"`
 * so it is idempotent and never clobbers a record that already moved on (e.g.
 * a manual retry that flipped it back to PROCESSING). Returns whether a
 * document was actually promoted.
 */
export async function promoteHaltedToFailed(knowledgeId: string): Promise<boolean> {
  const result = await _getDb()
    .collection(Collections.Knowledge)
    .updateOne(
      { knowledgeId, "status.state": "HALTED" },
      { $set: { "status.state": "FAILED", updatedAt: new Date() } },
    );
  return result.modifiedCount > 0;
}
