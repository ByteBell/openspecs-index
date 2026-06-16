/**
 * Canonical ingestion token-usage shape and small accumulation helpers.
 *
 * Every phase tracks two buckets:
 * - `tokenUsage` — the TOTAL observed this run (fresh provider calls + anything
 *   served from cache or resumed from disk).
 * - `cachedTokenUsage` — the subset that incurred NO fresh provider cost this run
 *   (served from the `@bb/llm` disk cache, or recovered from an on-disk condensed
 *   JSON on a retry).
 *
 * Billable "fresh" usage is `total − cached` and is computed only at the
 * metering/persistence boundary via `subUsage`.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** Sum any number of (possibly undefined) usages into a fresh object. */
export function addUsage(...parts: (TokenUsage | undefined)[]): TokenUsage {
  const out: TokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const p of parts) {
    if (p === undefined) {
      continue;
    }
    out.inputTokens += p.inputTokens;
    out.outputTokens += p.outputTokens;
    out.costUsd += p.costUsd;
  }
  return out;
}

/** `total − cached`, floored at zero, i.e. the fresh (billable) usage. */
export function subUsage(total: TokenUsage, cached: TokenUsage | undefined): TokenUsage {
  const c = cached ?? ZERO_USAGE;
  return {
    inputTokens: Math.max(0, total.inputTokens - c.inputTokens),
    outputTokens: Math.max(0, total.outputTokens - c.outputTokens),
    costUsd: Math.max(0, total.costUsd - c.costUsd),
  };
}

export interface TokenAccumulator {
  /** Add a phase's total usage and its cached subset. */
  add(usage: TokenUsage | undefined, cached: TokenUsage | undefined): void;
  /** Running total (fresh + cached) observed so far. */
  total(): TokenUsage;
  /** Running cached (non-billable) subset so far. */
  cached(): TokenUsage;
  /** `total − cached` — the billable usage to meter against the subscription. */
  fresh(): TokenUsage;
}

/** Tracks `total` and `cached` usage across phases so callers stay terse. */
export function createTokenAccumulator(): TokenAccumulator {
  const totals: TokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const cachedTotals: TokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  return {
    add(usage, cached) {
      if (usage !== undefined) {
        totals.inputTokens += usage.inputTokens;
        totals.outputTokens += usage.outputTokens;
        totals.costUsd += usage.costUsd;
      }
      if (cached !== undefined) {
        cachedTotals.inputTokens += cached.inputTokens;
        cachedTotals.outputTokens += cached.outputTokens;
        cachedTotals.costUsd += cached.costUsd;
      }
    },
    total: () => ({ ...totals }),
    cached: () => ({ ...cachedTotals }),
    fresh: () => subUsage(totals, cachedTotals),
  };
}
