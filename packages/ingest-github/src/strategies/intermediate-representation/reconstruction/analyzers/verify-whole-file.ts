/**
 * The WHOLE-FILE EQUIVALENCE call. Hands the judge the original file and the deterministically
 * assembled file (header + per-unit structural skeletons) and shapes its JSON judgement into a
 * {@link WholeFileEquivalenceReport}. Degrades to a zero-completeness report on failure;
 * config / transport errors bubble up.
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import {
  pickBool,
  pickNumber,
} from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import { pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import {
  WHOLE_FILE_EQUIVALENCE_SYSTEM_PROMPT,
  buildWholeFileEquivalenceUserPrompt,
} from "#src/strategies/intermediate-representation/reconstruction/prompts/verify-file.ts";
import { usageOf } from "#src/strategies/intermediate-representation/usage.ts";

/** The judge's whole-file equivalence verdict. `reconstructionCompleteness` is a `[0,1]` fraction. */
export interface WholeFileEquivalenceReport {
  semanticEquivalent: boolean;
  missingFromAssembly: string[];
  reconstructionCompleteness: number;
}

export interface VerifyWholeFileResult {
  report: WholeFileEquivalenceReport;
  tokenUsage: TokenUsage;
}

function failedReport(): WholeFileEquivalenceReport {
  return { semanticEquivalent: false, missingFromAssembly: [], reconstructionCompleteness: 0 };
}

function parseReport(raw: Record<string, unknown>): WholeFileEquivalenceReport {
  const pct = pickNumber(raw["reconstruction_completeness_pct"], 0);
  return {
    semanticEquivalent: pickBool(raw["semantic_equivalent"]),
    missingFromAssembly: pickStringArray(raw["missing_from_assembly"]),
    reconstructionCompleteness: Math.max(0, Math.min(1, pct / 100)),
  };
}

/**
 * Runs the whole-file equivalence call.
 *
 * @param input - The original and assembled sources, the file label, and optional LLM context.
 * @returns The whole-file equivalence report and token usage.
 */
export async function verifyWholeFile(input: {
  relativePath: string;
  originalSource: string;
  assembledSource: string;
  llmCallContext?: AskLlmOptions;
}): Promise<VerifyWholeFileResult> {
  const userPrompt = buildWholeFileEquivalenceUserPrompt({
    originalSource: input.originalSource,
    assembledSource: input.assembledSource,
  });
  try {
    const response = await askJsonLLM<Record<string, unknown>>(
      WHOLE_FILE_EQUIVALENCE_SYSTEM_PROMPT,
      userPrompt,
      input.llmCallContext ?? {},
    );
    if (response.result === null) {
      logger.warn(`verifyWholeFile: ${input.relativePath} returned unparseable JSON`);
      return { report: failedReport(), tokenUsage: usageOf(response.usage) };
    }
    return { report: parseReport(response.result), tokenUsage: usageOf(response.usage) };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`verifyWholeFile: ${input.relativePath} askJsonLLM failed: ${msg}`);
    return { report: failedReport(), tokenUsage: ZERO_USAGE };
  }
}
