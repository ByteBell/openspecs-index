import { IngestError, UsageLimitExceededError } from "@bb/errors";
import { logger } from "@bb/logger";
import { KnowledgeState, type UsageGuard } from "@bb/types";
import { CancellationError, clearCancellation } from "./cancellation.ts";
import { classifyFailure, isRetryable } from "./failure-classifier.ts";
import { persistFailure, persistHalted, markNonRetryable } from "./run-helpers.ts";
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
  const { knowledgeId, usageGuard, progressContext, isAutoPull } = deps;
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
  if (isAutoPull === true) {
    // Background refresh of already-PROCESSED knowledge must never degrade it.
    // Restore the prior PROCESSED state (the pull set PROCESSING on entry), skip
    // FAILED/HALTED and the failure SSE, and throw non-retryable so the queue does
    // not retry. The row stays PROCESSED, so the finalizer's promoteHaltedToFailed
    // is inert and onJobExhausted early-returns. The next sweep retries.
    logger.warn(`pull: auto-pull failed for ${knowledgeId} (${category}: ${reason}); preserving PROCESSED`);
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
