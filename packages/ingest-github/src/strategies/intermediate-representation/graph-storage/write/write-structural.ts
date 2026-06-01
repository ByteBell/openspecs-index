import { runCypher } from "@bb/neo4j";
import type {
  IrFileStructuralNodes,
  IrParentRef,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Writes per-file structural nodes (publicSignatures, typeShapes, sections,
 * fileConstants, moduleLayout). Each node is keyed by `(knowledgeId, fileId, …)`
 * because its meaning is tied to position in this specific file. Existing
 * structural edges of these types are cleared first so a re-analysis doesn't
 * leave stale rows.
 */
export async function writeStructuralNodes(
  parent: IrParentRef,
  nodes: IrFileStructuralNodes,
): Promise<void> {
  const ctx = parentContext(parent);
  await runCypher(CLEAR_STRUCTURAL_EDGES(parent), ctx);

  if (nodes.publicSignatures.length > 0) {
    await runCypher(ATTACH_PUBLIC_SIGNATURES(parent), { ...ctx, fileId: parent.fileId, items: nodes.publicSignatures });
  }
  if (nodes.typeShapes.length > 0) {
    await runCypher(ATTACH_TYPE_SHAPES(parent), { ...ctx, fileId: parent.fileId, items: nodes.typeShapes });
  }
  if (nodes.sections.length > 0) {
    await runCypher(ATTACH_SECTIONS(parent), { ...ctx, fileId: parent.fileId, items: nodes.sections });
  }
  if (nodes.fileConstants.length > 0) {
    await runCypher(ATTACH_FILE_CONSTANTS(parent), { ...ctx, fileId: parent.fileId, items: nodes.fileConstants });
  }
  if (nodes.moduleLayout.length > 0) {
    await runCypher(ATTACH_MODULE_LAYOUT(parent), { ...ctx, fileId: parent.fileId, items: nodes.moduleLayout });
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

const STRUCTURAL_RELS = ["DECLARES_PUBLIC", "DECLARES_TYPE_SHAPE", "HAS_SECTION", "DECLARES_CONSTANT", "HAS_LAYOUT_ENTRY"];

function CLEAR_STRUCTURAL_EDGES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
OPTIONAL MATCH (p)-[r:${STRUCTURAL_RELS.join("|")}]->()
DELETE r`;
}

function ATTACH_PUBLIC_SIGNATURES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (s:PublicSignature {knowledgeId: $knowledgeId, fileId: $fileId, kind: it.kind, name: it.name})
SET s.signature = it.signature,
    s.generics = it.generics,
    s.decorators = it.decorators,
    s.returnType = it.returnType,
    s.exported = it.exported
MERGE (p)-[r:DECLARES_PUBLIC]->(s)
SET r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_TYPE_SHAPES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (t:TypeShape {knowledgeId: $knowledgeId, fileId: $fileId, name: it.name})
SET t.kind = it.kind,
    t.shape = it.shape,
    t.discriminant = it.discriminant
MERGE (p)-[r:DECLARES_TYPE_SHAPE]->(t)
SET r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_SECTIONS(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (s:Section {knowledgeId: $knowledgeId, fileId: $fileId, name: it.name})
SET s.intent = it.intent,
    s.structureKind = it.structureKind,
    s.predicate = it.predicate,
    s.branchOutcomes = it.branchOutcomes,
    s.bounds = it.bounds,
    s.terminationCondition = it.terminationCondition
MERGE (p)-[r:HAS_SECTION]->(s)
SET r.order = it.order,
    r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_FILE_CONSTANTS(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (c:FileConstant {knowledgeId: $knowledgeId, fileId: $fileId, name: it.name, value: it.value, kind: it.kind})
MERGE (p)-[:DECLARES_CONSTANT]->(c)`;
}

function ATTACH_MODULE_LAYOUT(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (m:ModuleLayoutEntry {knowledgeId: $knowledgeId, fileId: $fileId, order: it.order})
SET m.label = it.label
MERGE (p)-[r:HAS_LAYOUT_ENTRY]->(m)
SET r.order = it.order`;
}
