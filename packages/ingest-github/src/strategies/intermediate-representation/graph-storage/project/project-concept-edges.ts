import type { ModuleIr } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type {
  IrConceptEdges,
  IrContractEdge,
  IrExternalImportEdge,
  IrInternalImportEdge,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Projects every "this file declares/has/imports/exports/provides X" array on
 * `ModuleIr` into edge bags. Each downstream writer MERGEs the global concept
 * node (Keyword, Class, ImportedModule, …) and then MERGEs the edge from the
 * parent `:File`/`:Chunk` to that node, so identical strings from many files
 * share one node.
 *
 * Keywords are lowercased (matches flat-folder); other names are passed through
 * verbatim because case is meaningful for classes / exports / contracts.
 */
export function projectConceptEdges(m: ModuleIr): IrConceptEdges {
  return {
    keywords: dedupe(m.keywords.map((k) => k.toLowerCase())),
    ontologyConcepts: dedupe(m.ontologyConcepts),
    businessEntities: dedupe(m.businessEntities),
    systemCapabilities: dedupe(m.systemCapabilities),
    configDependencies: dedupe(m.configDependencies),
    integrationSurface: dedupe(m.integrationSurface),
    classes: dedupe(m.classes),
    functions: dedupe(m.functions),
    exports: dedupe(m.exports),
    importsInternal: projectInternalImports(m),
    importsExternal: projectExternalImports(m),
    contractsProvided: projectContracts(m.contractsProvided),
    contractsConsumed: projectContracts(m.contractsConsumed),
  };
}

function projectInternalImports(m: ModuleIr): IrInternalImportEdge[] {
  return m.importsInternal.map((imp) => ({
    spec: imp.spec,
    symbols: imp.symbols,
    anchorStart: imp.anchor.startLine,
    anchorEnd: imp.anchor.endLine,
    resolvedRelativePath: imp.resolvedRelativePath,
    resolvedFileId: imp.resolvedFileId,
  }));
}

function projectExternalImports(m: ModuleIr): IrExternalImportEdge[] {
  return m.importsExternal.map((imp) => ({
    spec: imp.spec,
    symbols: imp.symbols,
    packageName: imp.package,
    anchorStart: imp.anchor.startLine,
    anchorEnd: imp.anchor.endLine,
  }));
}

function projectContracts(
  src: ModuleIr["contractsProvided"] | ModuleIr["contractsConsumed"],
): IrContractEdge[] {
  return src.map((c) => ({
    name: c.name,
    shape: c.shape,
    resolvedRelativePath: c.resolvedRelativePath,
    resolvedFileId: c.resolvedFileId,
  }));
}

function dedupe(items: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
