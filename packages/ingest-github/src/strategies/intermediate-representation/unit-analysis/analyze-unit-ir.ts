/**
 * The unit-IR analysis phase (one LLM call per unit). Hands one unit's verbatim source to the
 * model and shapes the response into a {@link CodeUnit} (fingerprint still empty — set later
 * by the orchestrator). `mustCapture` carries verification gaps appended on the single retry.
 * Degrades to an empty unit on unparseable / failed responses; config / transport errors bubble
 * up.
 *
 * The `AnalyzeUnitIrResult` envelope is declared here (alongside the call that produces it) —
 * it is a unit-analysis concept, not a reconstruction one.
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { parseCodeUnit } from "#src/strategies/intermediate-representation/unit-analysis/parse/code-unit.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/unit-analysis/types/code-unit.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import {
  UNIT_IR_SYSTEM_PROMPT,
  buildUnitIrUserPrompt,
} from "#src/strategies/intermediate-representation/unit-analysis/prompts/unit-ir.ts";
import { usageOf } from "#src/strategies/intermediate-representation/usage.ts";

/** Input to {@link analyzeUnitIr}. */
export interface AnalyzeUnitIrInput {
  descriptor: UnitDescriptor;
  fileId: string;
  language: string;
  relativePath: string;
  /** Imports + sibling signatures, for call/type resolution only. */
  context: string;
  /** `missingFromIr` hints from a failed verification; empty on the first attempt. */
  mustCapture: string[];
  llmCallContext?: AskLlmOptions;
}

/**
 * Result of the unit-IR call. The `codeUnit` here has an empty `semanticFingerprint` — the
 * fingerprint is computed only once the unit is finalised. `model` is the model id the LLM
 * client actually answered with for this call (the surviving fallback, if any); empty when no
 * call succeeded.
 */
export interface AnalyzeUnitIrResult {
  codeUnit: CodeUnit;
  tokenUsage: TokenUsage;
  model: string;
}

/**
 * Runs the unit-IR analysis call for one unit.
 *
 * @param input - The unit descriptor, file id, language, resolution context, and retry hints.
 * @returns The shaped {@link CodeUnit} (empty fingerprint) plus the call's token usage and model.
 */
export async function analyzeUnitIr(input: AnalyzeUnitIrInput): Promise<AnalyzeUnitIrResult> {
  const { descriptor, fileId } = input;
  const userPrompt = buildUnitIrUserPrompt({
    language: input.language,
    unitKind: descriptor.unitKind,
    qualifiedName: descriptor.qualifiedName,
    relativePath: input.relativePath,
    context: input.context,
    unitSource: descriptor.source,
    mustCapture: input.mustCapture,
  });
  try {
    const response = await askJsonLLM<Record<string, unknown>>(
      UNIT_IR_SYSTEM_PROMPT,
      userPrompt,
      input.llmCallContext ?? {},
    );
    if (response.result === null) {
      logger.warn(`analyzeUnitIr: ${descriptor.qualifiedName} returned unparseable JSON`);
      return {
        codeUnit: parseCodeUnit({}, descriptor, fileId),
        tokenUsage: usageOf(response.usage),
        model: response.usage.model,
      };
    }
    return {
      codeUnit: parseCodeUnit(response.result, descriptor, fileId),
      tokenUsage: usageOf(response.usage),
      model: response.usage.model,
    };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`analyzeUnitIr: ${descriptor.qualifiedName} askJsonLLM failed: ${msg}`);
    return { codeUnit: parseCodeUnit({}, descriptor, fileId), tokenUsage: ZERO_USAGE, model: "" };
  }
}
