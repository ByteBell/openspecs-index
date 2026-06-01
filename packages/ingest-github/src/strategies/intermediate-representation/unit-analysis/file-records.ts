/**
 * Whole-file → persist-ready RECORDS. Splits a file into module IR + units, runs the per-unit
 * unit-analysis pipeline (extract + fingerprint) for every unit, and builds the `codeUnits`
 * map (keyed `codeUnitId-1`, `codeUnitId-2`, …) with each unit's deep IR attached under
 * `codeUnit`. The output is split into a MODULE-level `record` (→ file-analysis) and the
 * `codeUnits` map (→ code-units) so the caller can persist them separately. Used for normal
 * files AND for each chunk of a big file.
 *
 * Reconstruction (regenerate-from-spec) and verify are NOT performed here — they live in their
 * own surfaces (`reconstruction/`, `reconstruction/analyzers/verify-*`).
 */
import { type AskLlmOptions } from "@bb/llm";
import { logger } from "@bb/logger";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { languageFromPath } from "#src/adapters/llm-file-analyzer.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/unit-analysis/types/code-unit.ts";
import type {
  ModuleIr,
  UnitDescriptor,
} from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import { computeModuleFingerprint } from "#src/strategies/intermediate-representation/file-analysis/fingerprint.ts";
import { analyseFile as runFileAnalysis } from "#src/strategies/intermediate-representation/file-analysis/analyse-file.ts";
import { extractUnit } from "./extract-unit.ts";
import { buildResolutionContext } from "./resolution-context.ts";

/** One entry of the `codeUnits` map: the split descriptor plus the deep IR under `codeUnit`. */
export interface CodeUnitEntry extends UnitDescriptor {
  codeUnit?: CodeUnit;
}

/** The MODULE-level record for one file (→ file-analysis). The units live separately in the `codeUnits` map. */
export interface FileModuleRecord {
  fileId: string;
  relativePath: string;
  language: string;
  module: ModuleIr;
  unitCount: number;
  tokenUsage: TokenUsage;
}

/** The standalone code-units artifact for one file: every unit keyed codeUnitId-1, codeUnitId-2, …. */
export interface CodeUnitsRecord {
  fileId: string;
  relativePath: string;
  codeUnits: Record<string, CodeUnitEntry>;
}

/** Result of {@link analyzeFileToRecords}: the module record and the keyed code-units map. */
export interface FileRecords {
  record: FileModuleRecord;
  codeUnits: Record<string, CodeUnitEntry>;
}

/** Input to {@link analyzeFileToRecords}. */
export interface AnalyzeFileToRecordsInput {
  relativePath: string;
  fileNodeId: string;
  source: string;
  /** Overrides the path-derived language hint when supplied. */
  language?: string;
  llmCallContext?: AskLlmOptions;
}

/** The stable 1-based key for the Nth discovered unit in a file's `codeUnits` map. */
export function codeUnitKey(index: number): string {
  return `codeUnitId-${index + 1}`;
}

/**
 * Analyzes one file (or one big-file chunk) into a module record + a keyed code-units map.
 *
 * @param input - Path, node id, source, language hint, and LLM context.
 * @returns The module-level record and the `codeUnits` map.
 */
export async function analyzeFileToRecords(input: AnalyzeFileToRecordsInput): Promise<FileRecords> {
  const language = input.language ?? languageFromPath(input.relativePath);
  const split = await runFileAnalysis({
    language,
    relativePath: input.relativePath,
    fileNodeId: input.fileNodeId,
    source: input.source,
    ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
  });
  const descriptors = split.split.units;
  const module: ModuleIr = {
    ...split.split.module,
    semanticFingerprint: computeModuleFingerprint(split.split.module, input.relativePath),
  };
  logger.debug(`analyzeFileToRecords: ${input.relativePath} — SPLIT found ${descriptors.length} unit(s)`);

  const codeUnits: Record<string, CodeUnitEntry> = {};
  const context = buildResolutionContext(split.split.module, descriptors);
  let usage = addUsage(ZERO_USAGE, split.tokenUsage);
  let i = 0;
  for (const descriptor of descriptors) {
    const result = await extractUnit({
      descriptor,
      fileId: input.fileNodeId,
      language: module.language,
      relativePath: input.relativePath,
      context,
      ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
    });
    usage = addUsage(usage, result.tokenUsage);
    codeUnits[codeUnitKey(i)] = { ...descriptor, codeUnit: result.codeUnit };
    i += 1;
  }
  return {
    record: buildRecord(input.fileNodeId, input.relativePath, module, descriptors.length, usage),
    codeUnits,
  };
}

function buildRecord(
  fileId: string,
  relativePath: string,
  module: ModuleIr,
  unitCount: number,
  tokenUsage: TokenUsage,
): FileModuleRecord {
  return { fileId, relativePath, language: module.language, module, unitCount, tokenUsage };
}
