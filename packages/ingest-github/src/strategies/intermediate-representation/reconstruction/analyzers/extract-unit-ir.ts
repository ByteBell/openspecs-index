/**
 * The UNIT-IR phase (one LLM call per unit). Hands one unit's verbatim source to the model and
 * shapes the response into a {@link CodeUnit} (fingerprint still empty — set later by the
 * pipeline). `mustCapture` carries verification gaps appended on the single retry. Degrades to
 * an empty unit on unparseable / failed responses; config / transport errors bubble up.
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { ZERO_USAGE } from "#src/strategies/intermediate-representation/parse.ts";
import { parseCodeUnit } from "#src/strategies/intermediate-representation/reconstruction/parse/code-unit.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/reconstruction/types/module-ir.ts";
import type { UnitIrResult } from "#src/strategies/intermediate-representation/reconstruction/types/results.ts";
import {
  UNIT_IR_SYSTEM_PROMPT,
  buildUnitIrUserPrompt,
} from "#src/strategies/intermediate-representation/reconstruction/prompts/unit-ir.ts";
import { usageOf } from "./usage.ts";

/** Input to the unit-IR phase. */
export interface ExtractUnitIrInput {
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
 * Runs the unit-IR phase for one unit.
 *
 * @param input - The unit descriptor, file id, language, resolution context, and retry hints.
 * @returns The shaped {@link CodeUnit} (empty fingerprint) plus the call's token usage.
 */
export async function extractUnitIr(input: ExtractUnitIrInput): Promise<UnitIrResult> {
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
      logger.warn(`extractUnitIr: ${descriptor.qualifiedName} returned unparseable JSON`);
      return { codeUnit: parseCodeUnit({}, descriptor, fileId), tokenUsage: usageOf(response.usage) };
    }
    return { codeUnit: parseCodeUnit(response.result, descriptor, fileId), tokenUsage: usageOf(response.usage) };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`extractUnitIr: ${descriptor.qualifiedName} askJsonLLM failed: ${msg}`);
    return { codeUnit: parseCodeUnit({}, descriptor, fileId), tokenUsage: ZERO_USAGE };
  }
}
