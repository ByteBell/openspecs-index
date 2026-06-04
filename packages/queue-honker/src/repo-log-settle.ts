// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
//
// Per-repo log settling helpers (see `@bb/logger`'s `withRepoLog` /
// `settleRepoLog`). Kept out of `provider.ts` so that file stays under the
// 300-line cap; the provider just calls these at terminal points.

import type { Database, Job } from "@russellthehippo/honker-node";
import { logger, settleRepoLog } from "@bb/logger";

/** Best-effort knowledgeId extraction from a job payload for repo-log settling. */
export function knowledgeIdOf(job: Job): string {
  const payload = job.payload as { knowledgeId?: unknown };
  return typeof payload.knowledgeId === "string" ? payload.knowledgeId : "";
}

/**
 * Folds the per-repo log of any dead-lettered job into archive/. A job lands in
 * `_honker_dead` only after its retries are exhausted, so this is the
 * authoritative "terminal failure" signal — the per-attempt handler can't see
 * it (it just throws and lets the provider decide whether to retry).
 * `settleRepoLog` is idempotent, so re-settling already-archived rows on each
 * 30s sweep is a harmless no-op.
 */
export function settleDeadRepoLogs(db: Database): void {
  try {
    const rows = db.query(
      "SELECT DISTINCT json_extract(payload, '$.knowledgeId') AS knowledgeId FROM _honker_dead",
      null,
    );
    for (const row of rows) {
      const knowledgeId = row["knowledgeId"];
      if (typeof knowledgeId === "string" && knowledgeId.length > 0) {
        settleRepoLog(knowledgeId);
      }
    }
  } catch (err) {
    logger.warn(`queue-honker: settleDeadRepoLogs threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}
