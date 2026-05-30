/**
 * The result envelopes returned by the exposed analyzer phases. Each carries its own
 * `TokenUsage` so callers can meter cost per phase and sum across a file.
 */
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { CodeUnit } from "./code-unit.ts";
import type { FileAnalysisResult, ModuleIr } from "./module-ir.ts";
import type { UnitVerification } from "./verification.ts";

/** Result of the file-analysis call: the file split plus the call's token usage. */
export interface AnalyseFileResult {
  split: FileAnalysisResult;
  tokenUsage: TokenUsage;
}

/**
 * Result of Prompt 2 (unit IR). The `codeUnit` here has an empty `semanticFingerprint` —
 * the fingerprint is computed only once the unit is finalised (post-verification).
 */
export interface UnitIrResult {
  codeUnit: CodeUnit;
  tokenUsage: TokenUsage;
}

/** Result of Prompt 3 (regenerate + verify) for one unit. */
export interface VerifyUnitResult {
  verification: UnitVerification;
  tokenUsage: TokenUsage;
}

/**
 * The finalised reconstruction of one unit: the fingerprinted `CodeUnit`, whether the
 * round-trip passed, how many attempts it took, and the cumulative usage across all calls
 * spent on this unit (extract + verify + any retry).
 */
export interface UnitReconstruction {
  codeUnit: CodeUnit;
  verification: UnitVerification;
  attempts: number;
  tokenUsage: TokenUsage;
}

/**
 * The whole-file reconstruction result: the fingerprinted module IR, every finalised unit,
 * and the summed token usage. `reconstructionCompleteness` is the mean of the per-unit
 * completeness scores (1 when there are no behavioral units to verify).
 */
export interface FileReconstructionResult {
  fileId: string;
  relativePath: string;
  language: string;
  module: ModuleIr;
  units: UnitReconstruction[];
  reconstructionCompleteness: number;
  tokenUsage: TokenUsage;
}
