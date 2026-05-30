/**
 * Per-unit orchestration: extract the unit IR, verify it round-trips, and — if the round-trip
 * fails — re-extract ONCE with the verifier's `missingFromIr` as MUST-CAPTURE hints, then
 * re-verify. The finalised unit's `semanticFingerprint` is computed in code (file-path-unique).
 * Token usage is summed across every call spent on the unit.
 */
import { type AskLlmOptions } from "@bb/llm";
import { addUsage, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/reconstruction/types/module-ir.ts";
import type { UnitReconstruction } from "#src/strategies/intermediate-representation/reconstruction/types/results.ts";
import type { UnitVerification } from "#src/strategies/intermediate-representation/reconstruction/types/verification.ts";
import { computeUnitFingerprint } from "#src/strategies/intermediate-representation/reconstruction/fingerprint.ts";
import { extractUnitIr } from "#src/strategies/intermediate-representation/reconstruction/analyzers/extract-unit-ir.ts";
import { verifyUnit } from "#src/strategies/intermediate-representation/reconstruction/analyzers/verify-unit.ts";

/** Input to the per-unit pipeline. */
export interface AnalyzeUnitInput {
  descriptor: UnitDescriptor;
  fileId: string;
  language: string;
  relativePath: string;
  /** Imports + sibling signatures for resolution only. */
  context: string;
  llmCallContext?: AskLlmOptions;
}

/** Builds the unit-IR extraction input, threading the optional LLM context only when present. */
function extractInput(input: AnalyzeUnitInput, mustCapture: string[]): Parameters<typeof extractUnitIr>[0] {
  return {
    descriptor: input.descriptor,
    fileId: input.fileId,
    language: input.language,
    relativePath: input.relativePath,
    context: input.context,
    mustCapture,
    ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
  };
}

/** Builds the verify input, threading the optional LLM context only when present. */
function verifyInput(input: AnalyzeUnitInput, unit: CodeUnit): Parameters<typeof verifyUnit>[0] {
  return {
    unit,
    originalSource: input.descriptor.source,
    ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
  };
}

/**
 * Runs the full per-unit pipeline (extract → verify → at most one retry → fingerprint).
 *
 * @param input - The unit descriptor, file id, language, path, and resolution context.
 * @returns The finalised {@link UnitReconstruction}.
 */
export async function analyzeUnit(input: AnalyzeUnitInput): Promise<UnitReconstruction> {
  const first = await extractUnitIr(extractInput(input, []));
  let usage: TokenUsage = first.tokenUsage;
  let codeUnit: CodeUnit = first.codeUnit;

  let verified = await verifyUnit(verifyInput(input, codeUnit));
  usage = addUsage(usage, verified.tokenUsage);
  let attempts = 1;

  if (!verified.verification.report.semanticEquivalent) {
    attempts = 2;
    const retry = await extractUnitIr(extractInput(input, verified.verification.report.missingFromIr));
    usage = addUsage(usage, retry.tokenUsage);
    codeUnit = retry.codeUnit;
    verified = await verifyUnit(verifyInput(input, codeUnit));
    usage = addUsage(usage, verified.tokenUsage);
  }

  const verification: UnitVerification = verified.verification;
  const fingerprinted: CodeUnit = {
    ...codeUnit,
    semanticFingerprint: computeUnitFingerprint(codeUnit, input.relativePath),
  };
  return { codeUnit: fingerprinted, verification, attempts, tokenUsage: usage };
}
