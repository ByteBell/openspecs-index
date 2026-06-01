/**
 * Per-unit extraction: run the unit-IR analysis call and compute the fingerprint. NO verify,
 * NO retry — this surface stops at "extract + fingerprint". Reconstruction
 * (regenerate-from-spec) lives separately in `reconstruction/reconstruct-*.ts` and is not
 * invoked here.
 */
import { type AskLlmOptions } from "@bb/llm";
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/unit-analysis/types/code-unit.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import { computeUnitFingerprint } from "#src/strategies/intermediate-representation/unit-analysis/fingerprint.ts";
import { analyzeUnitIr } from "#src/strategies/intermediate-representation/unit-analysis/analyze-unit-ir.ts";

/** Input to {@link extractUnit}. */
export interface ExtractUnitInput {
  descriptor: UnitDescriptor;
  fileId: string;
  language: string;
  relativePath: string;
  /** Imports + sibling signatures for resolution only. */
  context: string;
  llmCallContext?: AskLlmOptions;
}

/**
 * Result of {@link extractUnit}. `attempts` is always 1 (no retry at this layer). `model` is
 * the model the unit-IR call answered with.
 */
export interface ExtractUnitResult {
  codeUnit: CodeUnit;
  attempts: number;
  tokenUsage: TokenUsage;
  model: string;
}

/**
 * Extracts one unit's IR and computes its fingerprint.
 *
 * @param input - The unit descriptor, file id, language, path, and resolution context.
 * @returns The fingerprinted {@link CodeUnit} with the call's token usage and model.
 */
export async function extractUnit(input: ExtractUnitInput): Promise<ExtractUnitResult> {
  const analysed = await analyzeUnitIr({
    descriptor: input.descriptor,
    fileId: input.fileId,
    language: input.language,
    relativePath: input.relativePath,
    context: input.context,
    mustCapture: [],
    ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
  });
  const fingerprinted: CodeUnit = {
    ...analysed.codeUnit,
    semanticFingerprint: computeUnitFingerprint(analysed.codeUnit, input.relativePath),
  };
  return { codeUnit: fingerprinted, attempts: 1, tokenUsage: analysed.tokenUsage, model: analysed.model };
}
