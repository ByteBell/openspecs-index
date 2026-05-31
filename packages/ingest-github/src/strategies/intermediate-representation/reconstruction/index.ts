/**
 * Public barrel for the reconstruction (recreate-and-diff) loop. Importers should depend ONLY
 * on this file, never on internal modules.
 *
 * The file-analysis (SPLIT) call and its types live in `../file-analysis/` and are NOT
 * re-exported here — they are not part of reconstruction's surface. Callers that need them
 * import from `#src/strategies/intermediate-representation/file-analysis/...` directly.
 */
export { createReconstructionAnalyzer, type ReconstructionAnalyzer } from "./analyzer.ts";

// Phase inputs (for callers stepping a single phase).
export type { ExtractUnitIrInput } from "./analyzers/extract-unit-ir.ts";
export type { VerifyUnitInput } from "./analyzers/verify-unit.ts";
export type { AnalyzeUnitInput } from "./pipeline/analyze-unit.ts";
export type { AnalyzeFileInput } from "./pipeline/analyze-file.ts";

// Result envelopes for the reconstruction phases (file-analysis's envelope lives in file-analysis/).
export type {
  UnitIrResult,
  VerifyUnitResult,
  UnitReconstruction,
  FileReconstructionResult,
} from "./types/results.ts";

// Per-unit IR shapes (for consumers persisting / querying the records).
export type {
  CodeUnit,
  CodeUnitParameter,
  LogicStep,
  ErrorPolicy,
  UnitCall,
  UnitMember,
  UnitConstant,
  VerbatimBlock,
  ExampleIoPair,
} from "./types/code-unit.ts";
export type { EquivalenceReport, UnitVerification } from "./types/verification.ts";
export type { WholeFileEquivalenceReport } from "./analyzers/verify-whole-file.ts";
export { verifyWholeFile } from "./analyzers/verify-whole-file.ts";
export { assembleFileFromUnits } from "./pipeline/reconstruct-file.ts";

// Unit fingerprint — computed in code, never by the LLM. The module fingerprint lives in
// file-analysis/.
export { computeUnitFingerprint } from "./fingerprint.ts";

// File → records: module-level record + keyed code-units map. Shared by the normal-file path and
// the big-file per-chunk reconstruction; used by callers that persist file-analysis + code-units.
export { analyzeFileToRecords, codeUnitKey } from "./pipeline/file-records.ts";
export type {
  AnalyzeFileToRecordsInput,
  FileRecords,
  FileModuleRecord,
  CodeUnitsRecord,
  CodeUnitEntry,
} from "./pipeline/file-records.ts";
