/**
 * Module-level (FileNode) reconstruction IR and the Prompt 1 split shapes.
 *
 * `ModuleIr` is the file-level binding written onto the `FileNode` (module layout, top-level
 * code, exports, import map, file constants). `UnitDescriptor` is one entry of the unit list
 * Prompt 1 enumerates — a span plus verbatim source, fed individually into Prompt 2.
 */
import type { UnitConstant } from "./named-constant.ts";
import type { SemanticFields } from "./semantics.ts";

/** One entry of the resolved import symbol map. */
export interface ImportSymbol {
  symbol: string;
  module: string;
  alias: string | null;
  kind: "internal" | "external";
}

/**
 * The module-level IR for a single file, written onto the `FileNode`. A file has many units,
 * so the flat-folder semantic analysis (purpose/summary/keywords/contracts/...) lives here
 * ONCE — `ModuleIr` extends {@link SemanticFields} so those fields are direct members. The
 * reconstruction-specific module fields (layout, top-level code, exports, import map, file
 * constants) sit alongside. `semanticFingerprint` is computed in code, not by the LLM.
 */
export interface ModuleIr extends SemanticFields {
  language: string;
  moduleLayout: string[];
  moduleLevelCode: string | null;
  exports: string[];
  importSymbolMap: ImportSymbol[];
  fileConstants: UnitConstant[];
  semanticFingerprint: string;
}

/**
 * One unit discovered by the splitter. `source` is the verbatim text of just this unit, used
 * as the sole input to Prompt 2. `isBehavioral` marks units carrying executable logic
 * (function/method/modifier/macro/constructor) so the pipeline knows which fields to expect.
 */
export interface UnitDescriptor {
  unitId: string;
  unitKind: string;
  name: string;
  qualifiedName: string;
  parentUnitId: string | null;
  startLine: number;
  endLine: number;
  isBehavioral: boolean;
  source: string;
}

/** The full Prompt 1 result: the module IR plus every discovered unit, in source order. */
export interface FileAnalysisResult {
  module: ModuleIr;
  units: UnitDescriptor[];
}
