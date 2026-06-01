import { runCypher } from "@bb/neo4j";
import type {
  IrCodeUnitNodeBag,
  IrParentRef,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Writes the `:CodeUnit` nodes produced from `UnitDescriptor[]`. Each unit is
 * MERGEd by `(knowledgeId, unitId)` and attached to its parent (`:File` or
 * `:Chunk`) via `:HAS_UNIT`. Child-of edges (`:CHILD_OF`) are wired separately
 * in a second pass because the parent unit may appear after the child in the
 * descriptor list.
 *
 * The reconstruction phase will SET deeper properties (signature, parameters,
 * logicOutline, verbatimBlocks, …) on the same `:CodeUnit` node later — never
 * replacing what's here, only adding.
 */
export async function writeCodeUnits(parent: IrParentRef, units: IrCodeUnitNodeBag[]): Promise<void> {
  if (units.length === 0) return;
  const ctx = parentContext(parent);

  await runCypher(CLEAR_UNIT_EDGES(parent), ctx);
  await runCypher(UPSERT_UNITS, { units });
  await runCypher(ATTACH_UNITS_TO_PARENT(parent), { ...ctx, units });

  const withParents = units.filter((u) => u.parentUnitId !== null);
  if (withParents.length > 0) {
    await runCypher(ATTACH_CHILD_OF, {
      knowledgeId: parent.knowledgeId,
      links: withParents.map((u) => ({ unitId: u.unitId, parentUnitId: u.parentUnitId })),
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

function CLEAR_UNIT_EDGES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
OPTIONAL MATCH (p)-[r:HAS_UNIT]->()
DELETE r`;
}

const UPSERT_UNITS = `
UNWIND $units AS u
MERGE (cu:CodeUnit {knowledgeId: u.knowledgeId, unitId: u.unitId})
SET cu.orgId = u.orgId,
    cu.fileId = u.fileId,
    cu.parentScope = u.parentScope,
    cu.parentRelativePath = u.parentRelativePath,
    cu.parentChunkIndex = u.parentChunkIndex,
    cu.unitKind = u.unitKind,
    cu.name = u.name,
    cu.qualifiedName = u.qualifiedName,
    cu.parentUnitId = u.parentUnitId,
    cu.startLine = u.startLine,
    cu.endLine = u.endLine,
    cu.isBehavioral = u.isBehavioral
`;

function ATTACH_UNITS_TO_PARENT(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $units AS u
MATCH (cu:CodeUnit {knowledgeId: u.knowledgeId, unitId: u.unitId})
MERGE (p)-[:HAS_UNIT]->(cu)`;
}

const ATTACH_CHILD_OF = `
UNWIND $links AS link
MATCH (child:CodeUnit {knowledgeId: $knowledgeId, unitId: link.unitId})
MATCH (parent:CodeUnit {knowledgeId: $knowledgeId, unitId: link.parentUnitId})
MERGE (child)-[:CHILD_OF]->(parent)
`;
