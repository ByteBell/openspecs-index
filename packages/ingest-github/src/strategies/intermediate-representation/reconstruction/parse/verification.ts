/**
 * Narrows the LLM RESPONSE returned by the equivalence call (the second half of the verify
 * phase) into an {@link EquivalenceReport}. The model is handed the original and regenerated
 * source and returns its judgement; this module only validates that judgement.
 */
import { pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type { EquivalenceReport } from "#src/strategies/intermediate-representation/reconstruction/types/verification.ts";
import { pickBool, pickInt, pickNumber } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";

/** Narrows the judge's `reconstruction_completeness_pct` (0–100 int) into a `[0, 1]` fraction. */
function pickCompletenessFraction(raw: unknown): number {
  const pct = pickNumber(raw, 0);
  return Math.max(0, Math.min(1, pct / 100));
}

/**
 * Narrows the untrusted equivalence-call response into an {@link EquivalenceReport}.
 *
 * @param raw - The untrusted JSON object the model returned from the equivalence call.
 * @returns A fully-narrowed report; completeness is clamped to `[0, 1]`.
 */
export function parseEquivalenceReport(raw: Record<string, unknown>): EquivalenceReport {
  return {
    semanticEquivalent: pickBool(raw["semantic_equivalent"]),
    passingExampleIo: pickInt(raw["passing_example_io"], 0),
    totalExampleIo: pickInt(raw["total_example_io"], 0),
    missingFromIr: pickStringArray(raw["missing_from_ir"]),
    reconstructionCompleteness: pickCompletenessFraction(raw["reconstruction_completeness_pct"]),
  };
}
