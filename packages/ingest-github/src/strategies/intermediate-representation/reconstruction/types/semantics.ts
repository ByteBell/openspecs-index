/**
 * The flat-folder semantic/retrieval fields, flattened into a shared base so they become
 * DIRECT members of every IR node that extends it (`CodeUnit`, `ModuleIr`) — not a nested
 * `FileAnalysis` object. This is what makes the reconstruction IR a strict superset of the
 * flat-folder analysis: the same purpose/summary/keywords/contracts/... live here, the
 * reconstruction-specific fields sit alongside on each node.
 *
 * Mirrors `FileAnalysis` (`@bb/mongo`) field-for-field, but normalised to required values
 * (the parser fills `""` / `[]` defaults) so the IR is total and no field is `undefined`.
 */
import type { FileAnalysisSection } from "@bb/mongo";

export interface SemanticFields {
  purpose: string;
  summary: string;
  businessContext: string;
  classes: string[];
  functions: string[];
  importsInternal: string[];
  importsExternal: string[];
  keywords: string[];
  ontologyConcepts: string[];
  businessEntities: string[];
  systemCapabilities: string[];
  sideEffects: string[];
  configDependencies: string[];
  dataFlowDirection: string;
  integrationSurface: string[];
  contractsProvided: string[];
  contractsConsumed: string[];
  sectionMap: FileAnalysisSection[];
}
