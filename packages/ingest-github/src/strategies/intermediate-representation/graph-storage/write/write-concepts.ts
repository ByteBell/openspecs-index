import { runCypher } from "@bb/neo4j";
import type {
  IrConceptEdges,
  IrParentRef,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Writes the concept-graph edges that hang off a `:File` or `:Chunk` parent:
 * keywords, ontology concepts, business entities, system capabilities, config
 * dependencies, integration surfaces, classes, functions, exports, imported
 * modules, and contracts. Each concept node is MERGEd globally (or per-repo
 * where collision risk is real); the edge from the parent is MERGEd next so
 * the same string from many files lands on one node.
 *
 * Existing edges of these types are cleared first so a re-analysis doesn't
 * leave stale edges. Concept nodes themselves are NEVER deleted — they may be
 * referenced by other files.
 */
export async function writeConceptEdges(parent: IrParentRef, edges: IrConceptEdges): Promise<void> {
  const ctx = parentContext(parent);
  await runCypher(clearEdgesCypher(parent), ctx);

  if (edges.keywords.length > 0) {
    await runCypher(attachGlobalCypher(parent, "Keyword", "name", "HAS_KEYWORD"), {
      ...ctx,
      names: edges.keywords,
    });
  }
  if (edges.ontologyConcepts.length > 0) {
    await runCypher(attachGlobalCypher(parent, "OntologyConcept", "name", "HAS_ONTOLOGY_CONCEPT"), {
      ...ctx,
      names: edges.ontologyConcepts,
    });
  }
  if (edges.businessEntities.length > 0) {
    await runCypher(attachGlobalCypher(parent, "BusinessEntity", "name", "MENTIONS_BUSINESS_ENTITY"), {
      ...ctx,
      names: edges.businessEntities,
    });
  }
  if (edges.systemCapabilities.length > 0) {
    await runCypher(attachGlobalCypher(parent, "SystemCapability", "name", "PROVIDES_CAPABILITY"), {
      ...ctx,
      names: edges.systemCapabilities,
    });
  }
  if (edges.configDependencies.length > 0) {
    await runCypher(attachGlobalCypher(parent, "ConfigDependency", "key", "DEPENDS_ON_CONFIG"), {
      ...ctx,
      names: edges.configDependencies,
    });
  }
  if (edges.integrationSurface.length > 0) {
    await runCypher(attachGlobalCypher(parent, "IntegrationSurface", "name", "EXPOSES_INTEGRATION"), {
      ...ctx,
      names: edges.integrationSurface,
    });
  }
  if (edges.classes.length > 0) {
    await runCypher(attachRepoScopedCypher(parent, "Class", "signature", "DECLARES_CLASS"), {
      ...ctx,
      names: edges.classes,
    });
  }
  if (edges.functions.length > 0) {
    await runCypher(attachRepoScopedCypher(parent, "Function", "signature", "DECLARES_FUNCTION"), {
      ...ctx,
      names: edges.functions,
    });
  }
  if (edges.exports.length > 0) {
    await runCypher(attachRepoScopedCypher(parent, "ExportedSymbol", "name", "EXPORTS"), {
      ...ctx,
      names: edges.exports,
    });
  }
  if (edges.importsInternal.length > 0) {
    await runCypher(attachInternalImportsCypher(parent), { ...ctx, imports: edges.importsInternal });
  }
  if (edges.importsExternal.length > 0) {
    await runCypher(attachExternalImportsCypher(parent), { ...ctx, imports: edges.importsExternal });
  }
  if (edges.contractsProvided.length > 0) {
    await runCypher(attachContractsCypher(parent, "PROVIDES_CONTRACT"), {
      ...ctx,
      contracts: edges.contractsProvided,
    });
  }
  if (edges.contractsConsumed.length > 0) {
    await runCypher(attachContractsCypher(parent, "CONSUMES_CONTRACT"), {
      ...ctx,
      contracts: edges.contractsConsumed,
    });
  }
}

function parentContext(parent: IrParentRef): Record<string, unknown> {
  return parent.scope === "file"
    ? { knowledgeId: parent.knowledgeId, relativePath: parent.relativePath }
    : { knowledgeId: parent.knowledgeId, relativePath: parent.relativePath, chunkIndex: parent.chunkIndex };
}

function parentMatch(parent: IrParentRef): string {
  return parent.scope === "file"
    ? "MATCH (p:File {knowledgeId: $knowledgeId, relativePath: $relativePath})"
    : "MATCH (p:Chunk {knowledgeId: $knowledgeId, relativePath: $relativePath, chunkIndex: $chunkIndex})";
}

const CONCEPT_REL_TYPES = [
  "HAS_KEYWORD",
  "HAS_ONTOLOGY_CONCEPT",
  "MENTIONS_BUSINESS_ENTITY",
  "PROVIDES_CAPABILITY",
  "DEPENDS_ON_CONFIG",
  "EXPOSES_INTEGRATION",
  "DECLARES_CLASS",
  "DECLARES_FUNCTION",
  "EXPORTS",
  "IMPORTS_INTERNAL",
  "IMPORTS_EXTERNAL",
  "PROVIDES_CONTRACT",
  "CONSUMES_CONTRACT",
];

function clearEdgesCypher(parent: IrParentRef): string {
  return `${parentMatch(parent)}\nOPTIONAL MATCH (p)-[r:${CONCEPT_REL_TYPES.join("|")}]->() DELETE r`;
}

function attachGlobalCypher(parent: IrParentRef, label: string, keyProp: string, rel: string): string {
  return `${parentMatch(parent)}
UNWIND $names AS n
MERGE (x:${label} {${keyProp}: n})
MERGE (p)-[:${rel}]->(x)`;
}

function attachRepoScopedCypher(parent: IrParentRef, label: string, keyProp: string, rel: string): string {
  return `${parentMatch(parent)}
UNWIND $names AS n
MERGE (x:${label} {knowledgeId: $knowledgeId, ${keyProp}: n})
MERGE (p)-[:${rel}]->(x)`;
}

function attachInternalImportsCypher(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $imports AS imp
MERGE (m:ImportedModule {knowledgeId: $knowledgeId, spec: imp.spec})
  ON CREATE SET m.external = false
MERGE (p)-[r:IMPORTS_INTERNAL]->(m)
SET r.symbols = imp.symbols,
    r.anchorStart = imp.anchorStart,
    r.anchorEnd = imp.anchorEnd,
    r.resolvedRelativePath = imp.resolvedRelativePath,
    r.resolvedFileId = imp.resolvedFileId`;
}

function attachExternalImportsCypher(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $imports AS imp
MERGE (m:ImportedModule {knowledgeId: $knowledgeId, spec: imp.spec})
  ON CREATE SET m.external = true
SET m.packageName = imp.packageName
MERGE (p)-[r:IMPORTS_EXTERNAL]->(m)
SET r.symbols = imp.symbols,
    r.anchorStart = imp.anchorStart,
    r.anchorEnd = imp.anchorEnd`;
}

function attachContractsCypher(parent: IrParentRef, rel: string): string {
  return `${parentMatch(parent)}
UNWIND $contracts AS c
MERGE (con:Contract {knowledgeId: $knowledgeId, name: c.name, shape: c.shape})
MERGE (p)-[r:${rel}]->(con)
SET r.resolvedRelativePath = c.resolvedRelativePath,
    r.resolvedFileId = c.resolvedFileId`;
}
