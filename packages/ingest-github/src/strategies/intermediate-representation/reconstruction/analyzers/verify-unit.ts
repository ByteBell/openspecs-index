/**
 * The VERIFY phase for one unit: regenerate its source from the IR (step 1), then judge
 * equivalence against the original (step 2). Combines the two calls into one
 * {@link UnitVerification} and sums their token usage.
 */
import { type AskLlmOptions } from "@bb/llm";
import { addUsage, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import type { VerifyUnitResult } from "#src/strategies/intermediate-representation/reconstruction/types/results.ts";
import { regenerateUnit } from "./regenerate-unit.ts";
import { verifyEquivalence } from "./verify-equivalence.ts";

/** Input to the verify phase. */
export interface VerifyUnitInput {
  unit: CodeUnit;
  /** The unit's original verbatim source (the oracle). */
  originalSource: string;
  llmCallContext?: AskLlmOptions;
}

/**
 * Runs the verify phase (regenerate + equivalence) for one unit.
 *
 * @param input - The unit, its original source, and optional LLM call context.
 * @returns The regenerated source + equivalence report, plus summed token usage.
 */
export async function verifyUnit(input: VerifyUnitInput): Promise<VerifyUnitResult> {
  const regen = await regenerateUnit(input.unit, input.llmCallContext);
  const equiv = await verifyEquivalence({
    qualifiedName: input.unit.qualifiedName,
    originalSource: input.originalSource,
    regeneratedSource: regen.regeneratedSource,
    ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
  });
  const tokenUsage: TokenUsage = addUsage(regen.tokenUsage, equiv.tokenUsage);
  return {
    verification: { regeneratedSource: regen.regeneratedSource, report: equiv.report },
    tokenUsage,
  };
}
