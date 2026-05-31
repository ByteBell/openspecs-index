/**
 * The EQUIVALENCE call (verify phase, step 2). Hands the original and regenerated source to the
 * model and shapes its JSON judgement into an {@link EquivalenceReport}. Degrades to a
 * non-equivalent, zero-completeness report on failure; config / transport errors bubble up.
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { parseEquivalenceReport } from "#src/strategies/intermediate-representation/reconstruction/parse/verification.ts";
import type { EquivalenceReport } from "#src/strategies/intermediate-representation/reconstruction/types/verification.ts";
import {
  EQUIVALENCE_SYSTEM_PROMPT,
  buildEquivalenceUserPrompt,
} from "#src/strategies/intermediate-representation/reconstruction/prompts/verify.ts";
import { usageOf } from "#src/strategies/intermediate-representation/usage.ts";

/** The equivalence report plus the call's token usage. */
export interface VerifyEquivalenceResult {
  report: EquivalenceReport;
  tokenUsage: TokenUsage;
}

/** The report used when the equivalence call cannot be made or parsed. */
function failedReport(): EquivalenceReport {
  return {
    semanticEquivalent: false,
    passingExampleIo: 0,
    totalExampleIo: 0,
    missingFromIr: [],
    reconstructionCompleteness: 0,
  };
}

/**
 * Runs the equivalence call comparing original to regenerated source.
 *
 * @param input - The two sources to compare and optional LLM call context.
 * @returns The equivalence report and token usage.
 */
export async function verifyEquivalence(input: {
  qualifiedName: string;
  originalSource: string;
  regeneratedSource: string;
  llmCallContext?: AskLlmOptions;
}): Promise<VerifyEquivalenceResult> {
  const userPrompt = buildEquivalenceUserPrompt({
    originalSource: input.originalSource,
    regeneratedSource: input.regeneratedSource,
  });
  try {
    const response = await askJsonLLM<Record<string, unknown>>(
      EQUIVALENCE_SYSTEM_PROMPT,
      userPrompt,
      input.llmCallContext ?? {},
    );
    if (response.result === null) {
      logger.warn(`verifyEquivalence: ${input.qualifiedName} returned unparseable JSON`);
      return { report: failedReport(), tokenUsage: usageOf(response.usage) };
    }
    return { report: parseEquivalenceReport(response.result), tokenUsage: usageOf(response.usage) };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`verifyEquivalence: ${input.qualifiedName} askJsonLLM failed: ${msg}`);
    return { report: failedReport(), tokenUsage: ZERO_USAGE };
  }
}
