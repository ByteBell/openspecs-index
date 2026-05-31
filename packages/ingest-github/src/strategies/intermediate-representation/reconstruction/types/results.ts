/**
 * Per-phase result envelopes for the reconstruction (recreate-and-diff) loop. Each carries its
 * own `TokenUsage` so callers can meter cost per phase. The file-analysis call's envelope
 * (`AnalyseFileResult`) lives in `file-analysis/types/results.ts`, not here.
 */
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { ModuleIr } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type { CodeUnit } from "./code-unit.ts";
import type { UnitVerification } from "./verification.ts";
import type { WholeFileEquivalenceReport } from "#src/strategies/intermediate-representation/reconstruction/analyzers/verify-whole-file.ts";

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
 * the deterministically assembled file source, the whole-file judge verdict, and the summed
 * token usage. `reconstructionCompleteness` is the mean of the per-unit structural scores
 * (1 when there are no behavioral units to verify). `wholeFileCompleteness` is the whole-file
 * judge's `[0, 1]` score comparing the ASSEMBLED file to the ORIGINAL.
 */
export interface FileReconstructionResult {
  fileId: string;
  relativePath: string;
  language: string;
  module: ModuleIr;
  units: UnitReconstruction[];
  reconstructionCompleteness: number;
  assembledSource: string;
  wholeFileReport: WholeFileEquivalenceReport;
  wholeFileCompleteness: number;
  tokenUsage: TokenUsage;
}
