/**
 * Whole-file → persist-ready RECORDS. Splits a file into module IR + units, builds the `codeUnits`
 * map (keyed codeUnitId-1, codeUnitId-2, …), and — when `reconstructUnits` is set — runs the
 * per-unit pipeline (extract → verify → ≤1 retry → fingerprint) and appends each unit's deep IR
 * onto its map entry under `codeUnit`. The output is split into a MODULE-level `record` (→
 * file-analysis) and the `codeUnits` map (→ code-units), so the caller can persist them separately.
 * Used for a normal file AND for each chunk of a big file (see big-file/`reconstructBigFile`).
 */
import { type AskLlmOptions } from "@bb/llm";
import { logger } from "@bb/logger";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { languageFromPath } from "#src/adapters/llm-file-analyzer.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import type { ModuleIr, UnitDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import { computeModuleFingerprint } from "#src/strategies/intermediate-representation/file-analysis/fingerprint.ts";
import { analyseFile as runFileAnalysis } from "#src/strategies/intermediate-representation/file-analysis/analyse-file.ts";
import { analyzeUnit } from "./analyze-unit.ts";
import { buildResolutionContext } from "./resolution-context.ts";

/** One entry of the `codeUnits` map: the split descriptor, plus the deep IR under `codeUnit` when reconstructed. */
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
  reconstructionCompleteness: number;
  tokenUsage: TokenUsage;
}

/** The standalone code-units artifact for one file: every unit keyed codeUnitId-1, codeUnitId-2, …. */
export interface CodeUnitsRecord {
  fileId: string;
  relativePath: string;
  codeUnits: Record<string, CodeUnitEntry>;
}

/** Result of {@link analyzeFileToRecords}: the module record, the keyed code-units map, and round-trip passes. */
export interface FileRecords {
  record: FileModuleRecord;
  codeUnits: Record<string, CodeUnitEntry>;
  equivalentUnits: number;
}

/** Input to {@link analyzeFileToRecords}. */
export interface AnalyzeFileToRecordsInput {
  relativePath: string;
  fileNodeId: string;
  source: string;
  /** Overrides the path-derived language hint when supplied. */
  language?: string;
  /**
   * When true, each unit is fully reconstructed (extract → verify → retry → fingerprint) and its
   * deep IR is attached under `codeUnit`. When false, only the SPLIT runs (descriptors only).
   */
  reconstructUnits: boolean;
  llmCallContext?: AskLlmOptions;
}

/** The stable 1-based key for the Nth discovered unit in a file's `codeUnits` map. */
export function codeUnitKey(index: number): string {
  return `codeUnitId-${index + 1}`;
}

/**
 * Analyzes one file (or one big-file chunk) into a module record + a keyed code-units map.
 *
 * @param input - Path, node id, source, language hint, the reconstruct toggle, and LLM context.
 * @returns The module-level record, the `codeUnits` map, and the count of units that round-tripped.
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

  if (!input.reconstructUnits) {
    descriptors.forEach((descriptor, i) => {
      codeUnits[codeUnitKey(i)] = { ...descriptor };
    });
    return {
      record: buildRecord(input.fileNodeId, input.relativePath, module, descriptors.length, 1, split.tokenUsage),
      codeUnits,
      equivalentUnits: 0,
    };
  }

  const context = buildResolutionContext(split.split.module, descriptors);
  let usage = addUsage(ZERO_USAGE, split.tokenUsage);
  let completenessSum = 0;
  let equivalentUnits = 0;
  let i = 0;
  for (const descriptor of descriptors) {
    const reconstruction = await analyzeUnit({
      descriptor,
      fileId: input.fileNodeId,
      language: module.language,
      relativePath: input.relativePath,
      context,
      ...(input.llmCallContext !== undefined ? { llmCallContext: input.llmCallContext } : {}),
    });
    usage = addUsage(usage, reconstruction.tokenUsage);
    codeUnits[codeUnitKey(i)] = { ...descriptor, codeUnit: reconstruction.codeUnit };
    completenessSum += reconstruction.verification.report.reconstructionCompleteness;
    if (reconstruction.verification.report.semanticEquivalent) {
      equivalentUnits += 1;
    }
    i += 1;
  }
  const completeness = descriptors.length === 0 ? 1 : completenessSum / descriptors.length;
  return {
    record: buildRecord(input.fileNodeId, input.relativePath, module, descriptors.length, completeness, usage),
    codeUnits,
    equivalentUnits,
  };
}

/** Assembles the module-level record (the code units are returned separately). */
function buildRecord(
  fileId: string,
  relativePath: string,
  module: ModuleIr,
  unitCount: number,
  reconstructionCompleteness: number,
  tokenUsage: TokenUsage,
): FileModuleRecord {
  return { fileId, relativePath, language: module.language, module, unitCount, reconstructionCompleteness, tokenUsage };
}
