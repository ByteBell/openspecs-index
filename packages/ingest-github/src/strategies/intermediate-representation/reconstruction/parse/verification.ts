/**
 * Narrows the LLM RESPONSE returned by the equivalence call (the second half of the verify
 * phase) into an {@link EquivalenceReport}. The model is handed the original and regenerated
 * source and returns its judgement; this module only validates that judgement.
 */
import { pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type { EquivalenceReport } from "#src/strategies/intermediate-representation/reconstruction/types/verification.ts";
import { clamp01, pickBool, pickInt } from "./primitives.ts";

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
    reconstructionCompleteness: clamp01(raw["reconstruction_completeness"]),
  };
}
