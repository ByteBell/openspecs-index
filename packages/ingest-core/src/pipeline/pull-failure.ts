import { IngestError, UsageLimitExceededError } from "@bb/errors";
import { logger } from "@bb/logger";
import { KnowledgeState, type UsageGuard } from "@bb/types";
import { CancellationError, clearCancellation } from "./cancellation.ts";
import { classifyFailure, isRetryable } from "./failure-classifier.ts";
import { persistCorrupted, persistFailure, persistHalted, markNonRetryable } from "./run-helpers.ts";
import { transitionState } from "./pull-helpers.ts";
import type { ProgressContext } from "#src/progress/types.ts";

export interface PullFailureDeps {
  knowledgeId: string;
  usageGuard?: UsageGuard | undefined;
  progressContext: ProgressContext;
  /**
   * Unattended auto-pull / bulk refresh of already-`PROCESSED` knowledge. When
   * true, a failure must NOT degrade the existing index: restore `PROCESSED`,
   * skip `FAILED`/`HALTED` and the failure SSE, and throw non-retryable so the
   * queue stops (the next sweep retries on its interval).
   */
  isAutoPull?: boolean;
  /**
   * Enterprise hook fired when an auto-pull (`isAutoPull`) fails specifically on
   * a usage/billing limit (`usage_limit_exceeded`). Lets the multi-tenant wrapper
   * switch off auto-pull so the hourly sweep stops re-pulling a maxed-out account
   * every cycle. OSS standalone is single-tenant with no sweep — it leaves this
   * undefined. Best-effort: invoked under a `.catch()`, never blocks the
   * preserve-`PROCESSED` path.
   */
  onAutoPullUsageLimit?: () => Promise<void>;
}

/**
 * Translate a thrown cause from the pull pipeline into the correct persisted
 * state, then re-throw. Always throws — never returns. Mirrors the index path's
 * inline catch in `run.ts`:
 *
 * - Cancellation: clear the flag and re-throw verbatim.
 * - `UsageLimitExceededError`: flush the partial usage before classifying.
 * - Retryable: persist HALTED and throw a plain `IngestError` (queue retries).
 * - Terminal: persist FAILED, emit the failure SSE, throw a non-retryable error.
 */
export async function throwPullFailure(cause: unknown, deps: PullFailureDeps): Promise<never> {
  const { knowledgeId, usageGuard, progressContext, isAutoPull, onAutoPullUsageLimit } = deps;
  if (cause instanceof CancellationError) {
    clearCancellation(knowledgeId);
    logger.info(`pull: cancelled for ${knowledgeId}`);
    throw cause;
  }
  if (cause instanceof UsageLimitExceededError && usageGuard !== undefined) {
    await usageGuard.flushPartial(cause.cumulative).catch((flushErr: unknown) => {
      logger.warn(
        `pull: usageGuard.flushPartial failed for ${knowledgeId}: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`,
      );
    });
  }
  const { category, reason, detail } = classifyFailure(cause);
  if (category === "repo_unavailable") {
    // Terminal: the source repo is gone or inaccessible (deleted/renamed, or the
    // token lost access). No retry fixes it, and preserving PROCESSED on auto-pull
    // would let the sweep re-pull it every cycle (a Slack-alert loop). Mark the
    // knowledge CORRUPTED so the sweep (PROCESSED-only) drops it; the indexed data
    // stays queryable. Applies to both auto-pull and initial-index paths.
    logger.warn(`pull: ${knowledgeId} source repo unavailable (${reason}); marking CORRUPTED`);
    await persistCorrupted(knowledgeId, category, reason, detail);
    progressContext.failed(reason, undefined, category, detail);
    throw markNonRetryable(new IngestError(knowledgeId, `github_pull failed (corrupted): ${reason}`, cause));
  }
  if (isAutoPull === true) {
    // Background refresh of already-PROCESSED knowledge must never degrade it.
    // Restore the prior PROCESSED state (the pull set PROCESSING on entry), skip
    // FAILED/HALTED and the failure SSE, and throw non-retryable so the queue does
    // not retry. The row stays PROCESSED, so the finalizer's promoteHaltedToFailed
    // is inert and onJobExhausted early-returns. The next sweep retries.
    logger.warn(`pull: auto-pull failed for ${knowledgeId} (${category}: ${reason}); preserving PROCESSED`);
    if (category === "usage_limit_exceeded" && onAutoPullUsageLimit !== undefined) {
      // Maxed-out account: disable auto-pull (via the enterprise hook) so the
      // hourly sweep stops re-pulling and re-failing this repo every cycle.
      logger.warn(`pull: disabling auto-pull for ${knowledgeId} after usage limit (re-enable after upgrade)`);
      await onAutoPullUsageLimit().catch((hookErr: unknown) => {
        logger.warn(
          `pull: onAutoPullUsageLimit failed for ${knowledgeId}: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`,
        );
      });
    }
    await transitionState(knowledgeId, KnowledgeState.Processed).catch(() => undefined);
    throw markNonRetryable(new IngestError(knowledgeId, `github_pull auto-pull failed (preserved): ${reason}`, cause));
  }
  if (isRetryable(category)) {
    await persistHalted(knowledgeId, category, reason, detail);
    throw new IngestError(knowledgeId, `github_pull failed: ${reason}`, cause);
  }
  await persistFailure(knowledgeId, category, reason, detail);
  progressContext.failed(reason, undefined, category, detail);
  throw markNonRetryable(new IngestError(knowledgeId, `github_pull failed: ${reason}`, cause));
}
