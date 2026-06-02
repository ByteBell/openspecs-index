/**
 * Public barrel for the unit-analysis surface. Owns per-unit IR extraction + fingerprint plus
 * the file→records helper. Reconstruction (regenerate-from-spec) and verify are out of scope.
 */
export {
  analyzeUnitIr,
  type AnalyzeUnitIrInput,
  type AnalyzeUnitIrResult,
} from "./analyze-unit-ir.ts";

export { extractUnit, type ExtractUnitInput, type ExtractUnitResult } from "./extract-unit.ts";

export {
  extractUnitCached,
  type ExtractUnitCachedInput,
  type ExtractUnitCachedResult,
} from "./extract-unit-cached.ts";

export { computeUnitFingerprint } from "./fingerprint.ts";

export { buildResolutionContext } from "./resolution-context.ts";

export {
  analyzeFileToRecords,
  codeUnitKey,
  type AnalyzeFileToRecordsInput,
  type FileRecords,
  type FileModuleRecord,
  type CodeUnitsRecord,
  type CodeUnitEntry,
} from "./file-records.ts";

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
