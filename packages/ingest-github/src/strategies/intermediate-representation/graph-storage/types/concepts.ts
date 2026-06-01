/**
 * Concept-edge bags. Each entry projects to a global (or per-repo) concept node
 * + an edge from the parent `:File`/`:Chunk`. Identical strings from many files
 * land on one shared node downstream.
 */

export interface IrInternalImportEdge {
  spec: string;
  symbols: string[];
  anchorStart: number;
  anchorEnd: number;
  resolvedRelativePath: string | null;
  resolvedFileId: string | null;
}

export interface IrExternalImportEdge {
  spec: string;
  symbols: string[];
  packageName: string | null;
  anchorStart: number;
  anchorEnd: number;
}

export interface IrContractEdge {
  name: string;
  shape: string;
  resolvedRelativePath: string | null;
  resolvedFileId: string | null;
}

export interface IrConceptEdges {
  keywords: string[];
  ontologyConcepts: string[];
  businessEntities: string[];
  systemCapabilities: string[];
  configDependencies: string[];
  integrationSurface: string[];
  classes: string[];
  functions: string[];
  exports: string[];
  importsInternal: IrInternalImportEdge[];
  importsExternal: IrExternalImportEdge[];
  contractsProvided: IrContractEdge[];
  contractsConsumed: IrContractEdge[];
}
