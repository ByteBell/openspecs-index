/**
 * The exposed surface of the reconstruction (recreate-and-diff) path. `ReconstructionAnalyzer`
 * lets a caller run the whole file (`analyzeFile`) or step a single reconstruction phase —
 * unit-IR, verify, or the per-unit pipeline — independently. Every method returns its
 * `TokenUsage` for metering.
 *
 * The file-analysis (SPLIT) call lives in `file-analysis/analyse-file.ts` and is not exposed
 * here — reconstruction *consumes* file-analysis output, it does not own that call. Callers
 * that need the bare SPLIT call import `analyseFile` from `file-analysis/` directly.
 *
 * The facade is a thin delegator to the phase functions; it holds no state, so it is cheap to
 * create per request and trivial to stub in tests.
 */
import { extractUnitIr, type ExtractUnitIrInput } from "./analyzers/extract-unit-ir.ts";
import { verifyUnit, type VerifyUnitInput } from "./analyzers/verify-unit.ts";
import { analyzeUnit, type AnalyzeUnitInput } from "./pipeline/analyze-unit.ts";
import { analyzeFile, type AnalyzeFileInput } from "./pipeline/analyze-file.ts";
import type {
  UnitIrResult,
  VerifyUnitResult,
  UnitReconstruction,
  FileReconstructionResult,
} from "./types/results.ts";

/** The public, callable interface for the reconstruction (recreate-and-diff) loop. */
export interface ReconstructionAnalyzer {
  /** Unit-IR phase: one unit's source → its reconstruction IR. */
  extractUnitIr(input: ExtractUnitIrInput): Promise<UnitIrResult>;
  /** Verify phase: regenerate a unit from its IR and judge equivalence to the original. */
  verifyUnit(input: VerifyUnitInput): Promise<VerifyUnitResult>;
  /** Per-unit pipeline: extract → verify → at most one retry → fingerprint. */
  analyzeUnit(input: AnalyzeUnitInput): Promise<UnitReconstruction>;
  /** Whole-file pipeline: consume file-analysis split → analyze each unit → fingerprinted records. */
  analyzeFile(input: AnalyzeFileInput): Promise<FileReconstructionResult>;
}

/**
 * Creates a {@link ReconstructionAnalyzer}. Stateless — each method delegates to its phase fn.
 *
 * @returns A ready-to-use analyzer.
 */
export function createReconstructionAnalyzer(): ReconstructionAnalyzer {
  return { extractUnitIr, verifyUnit, analyzeUnit, analyzeFile };
}
