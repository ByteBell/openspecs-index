/**
 * Public barrel for the reconstruction-grade IR path. Importers should depend ONLY on this
 * file (the package's `index.ts` re-exports it), never on internal modules.
 */
export { createReconstructionAnalyzer, type ReconstructionAnalyzer } from "./analyzer.ts";

// Phase inputs (for callers stepping a single phase).
export type { AnalyseFileInput } from "./analyzers/analyse-file.ts";
export type { ExtractUnitIrInput } from "./analyzers/extract-unit-ir.ts";
export type { VerifyUnitInput } from "./analyzers/verify-unit.ts";
export type { AnalyzeUnitInput } from "./pipeline/analyze-unit.ts";
export type { AnalyzeFileInput } from "./pipeline/analyze-file.ts";

// Result envelopes.
export type {
  AnalyseFileResult,
  UnitIrResult,
  VerifyUnitResult,
  UnitReconstruction,
  FileReconstructionResult,
} from "./types/results.ts";

// IR shapes (for consumers persisting / querying the records).
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
export type { ModuleIr, ImportSymbol, UnitDescriptor, FileAnalysisResult } from "./types/module-ir.ts";
export type { SemanticFields } from "./types/semantics.ts";
export type { EquivalenceReport, UnitVerification } from "./types/verification.ts";

// Computed-in-code helpers (fingerprint + unit id) exposed for callers that persist records.
export { computeUnitFingerprint, computeModuleFingerprint } from "./fingerprint.ts";
export { buildUnitId } from "./unit-id.ts";

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
