/**
 * The exposed surface of the reconstruction-grade IR path. `ReconstructionAnalyzer` lets a
 * caller run the whole file (`analyzeFile`) or step a single phase — split, unit-IR, verify, or
 * the per-unit pipeline — independently. Every method returns its `TokenUsage` for metering.
 *
 * The facade is a thin delegator to the phase functions; it holds no state, so it is cheap to
 * create per request and trivial to stub in tests.
 */
import { analyseFile, type AnalyseFileInput } from "./analyzers/analyse-file.ts";
import { extractUnitIr, type ExtractUnitIrInput } from "./analyzers/extract-unit-ir.ts";
import { verifyUnit, type VerifyUnitInput } from "./analyzers/verify-unit.ts";
import { analyzeUnit, type AnalyzeUnitInput } from "./pipeline/analyze-unit.ts";
import { analyzeFile, type AnalyzeFileInput } from "./pipeline/analyze-file.ts";
import type {
  AnalyseFileResult,
  UnitIrResult,
  VerifyUnitResult,
  UnitReconstruction,
  FileReconstructionResult,
} from "./types/results.ts";

/** The public, callable interface for reconstruction-grade file analysis. */
export interface ReconstructionAnalyzer {
  /** File-analysis phase: whole file → file-level analysis + module IR + unit list. */
  analyseFile(input: AnalyseFileInput): Promise<AnalyseFileResult>;
  /** Unit-IR phase: one unit's source → its reconstruction IR. */
  extractUnitIr(input: ExtractUnitIrInput): Promise<UnitIrResult>;
  /** Verify phase: regenerate a unit from its IR and judge equivalence to the original. */
  verifyUnit(input: VerifyUnitInput): Promise<VerifyUnitResult>;
  /** Per-unit pipeline: extract → verify → at most one retry → fingerprint. */
  analyzeUnit(input: AnalyzeUnitInput): Promise<UnitReconstruction>;
  /** Whole-file pipeline: file-analysis → analyze each unit → fingerprinted, persist-ready records. */
  analyzeFile(input: AnalyzeFileInput): Promise<FileReconstructionResult>;
}

/**
 * Creates a {@link ReconstructionAnalyzer}. Stateless — each method delegates to its phase fn.
 *
 * @returns A ready-to-use analyzer.
 */
export function createReconstructionAnalyzer(): ReconstructionAnalyzer {
  return { analyseFile, extractUnitIr, verifyUnit, analyzeUnit, analyzeFile };
}
