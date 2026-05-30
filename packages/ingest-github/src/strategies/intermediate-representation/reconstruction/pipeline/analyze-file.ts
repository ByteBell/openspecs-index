/**
 * Whole-file orchestration: split the file into module IR + units, run the per-unit pipeline for
 * each unit (sequentially, so a single file stays within rate limits — the caller parallelises
 * across files), compute the module fingerprint, and assemble the {@link FileReconstructionResult}.
 * Optional scope keys are stamped onto every unit so the result is persist-ready.
 */
import { type AskLlmOptions } from "@bb/llm";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { languageFromPath } from "#src/adapters/llm-file-analyzer.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import type { ModuleIr } from "#src/strategies/intermediate-representation/reconstruction/types/module-ir.ts";
import type {
  FileReconstructionResult,
  UnitReconstruction,
} from "#src/strategies/intermediate-representation/reconstruction/types/results.ts";
import { computeModuleFingerprint } from "#src/strategies/intermediate-representation/reconstruction/fingerprint.ts";
import { analyseFile as runFileAnalysis } from "#src/strategies/intermediate-representation/reconstruction/analyzers/analyse-file.ts";
import { analyzeUnit } from "./analyze-unit.ts";
import { buildResolutionContext } from "./resolution-context.ts";

/** Input to the whole-file pipeline. */
export interface AnalyzeFileInput {
  relativePath: string;
  fileNodeId: string;
  source: string;
  /** Overrides the path-derived language hint when supplied. */
  language?: string;
  /** Scope keys stamped onto every produced unit; left undefined for the caller to fill. */
  knowledgeId?: string;
  orgId?: string;
  llmCallContext?: AskLlmOptions;
}

/** Returns a copy of `unit` with scope keys stamped when supplied. */
function withScope(unit: CodeUnit, knowledgeId?: string, orgId?: string): CodeUnit {
  return {
    ...unit,
    ...(knowledgeId !== undefined ? { knowledgeId } : {}),
    ...(orgId !== undefined ? { orgId } : {}),
  };
}

/** Mean reconstruction completeness across units (1 when there are no units to verify). */
function meanCompleteness(units: UnitReconstruction[]): number {
  if (units.length === 0) {
    return 1;
  }
  const sum = units.reduce((acc, u) => acc + u.verification.report.reconstructionCompleteness, 0);
  return sum / units.length;
}

/**
 * Runs the whole-file reconstruction pipeline.
 *
 * @param input - The file path, node id, source, and optional language / scope / LLM context.
 * @returns The fingerprinted module IR, every finalised unit, mean completeness, and summed usage.
 */
export async function analyzeFile(input: AnalyzeFileInput): Promise<FileReconstructionResult> {
  const language = input.language ?? languageFromPath(input.relativePath);
  const split = await runFileAnalysis({
    language,
    relativePath: input.relativePath,
    fileNodeId: input.fileNodeId,
    source: input.source,
    ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
  });
  let usage: TokenUsage = addUsage(ZERO_USAGE, split.tokenUsage);

  const units: UnitReconstruction[] = [];
  for (const descriptor of split.split.units) {
    const reconstruction = await analyzeUnit({
      descriptor,
      fileId: input.fileNodeId,
      language: split.split.module.language,
      relativePath: input.relativePath,
      context: buildResolutionContext(split.split.module, split.split.units),
      ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
    });
    usage = addUsage(usage, reconstruction.tokenUsage);
    units.push({ ...reconstruction, codeUnit: withScope(reconstruction.codeUnit, input.knowledgeId, input.orgId) });
  }

  const module: ModuleIr = {
    ...split.split.module,
    semanticFingerprint: computeModuleFingerprint(split.split.module, input.relativePath),
  };
  return {
    fileId: input.fileNodeId,
    relativePath: input.relativePath,
    language: module.language,
    module,
    units,
    reconstructionCompleteness: meanCompleteness(units),
    tokenUsage: usage,
  };
}
