import { runCypher } from "@bb/neo4j";
import type {
  IrParentRef,
  IrSubstrateNodes,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Writes the global substrate-by-content-hash nodes (verbatimLiterals, sideEffects,
 * edgeCases, boundaryConditions, errorHandling, invariants, diagnosticNotes,
 * assumptions, ambiguities). Each node MERGEs by content key so identical content
 * from different files lands on one shared node; the edge from `:File`/`:Chunk`
 * carries the per-file anchor and any positional modifiers.
 *
 * Existing substrate edges of these types are cleared first; nodes themselves are
 * never deleted because other files may reference them.
 */
export async function writeSubstrateNodes(
  parent: IrParentRef,
  nodes: IrSubstrateNodes,
): Promise<void> {
  const ctx = parentContext(parent);
  await runCypher(CLEAR_SUBSTRATE_EDGES(parent), ctx);

  if (nodes.verbatimLiterals.length > 0) {
    await runCypher(ATTACH_VERBATIM(parent), { ...ctx, items: nodes.verbatimLiterals });
  }
  if (nodes.sideEffects.length > 0) {
    await runCypher(ATTACH_SIDE_EFFECTS(parent), { ...ctx, items: nodes.sideEffects });
  }
  if (nodes.edgeCases.length > 0) {
    await runCypher(ATTACH_EDGE_CASES(parent), { ...ctx, items: nodes.edgeCases });
  }
  if (nodes.boundaryConditions.length > 0) {
    await runCypher(ATTACH_BOUNDARIES(parent), { ...ctx, items: nodes.boundaryConditions });
  }
  if (nodes.errorHandling.length > 0) {
    await runCypher(ATTACH_ERROR_HANDLING(parent), { ...ctx, items: nodes.errorHandling });
  }
  if (nodes.invariants.length > 0) {
    await runCypher(ATTACH_INVARIANTS(parent), { ...ctx, items: nodes.invariants });
  }
  if (nodes.diagnosticNotes.length > 0) {
    await runCypher(ATTACH_DIAGNOSTIC_NOTES(parent), { ...ctx, items: nodes.diagnosticNotes });
  }
  if (nodes.assumptions.length > 0) {
    await runCypher(ATTACH_ASSUMPTIONS(parent), { ...ctx, items: nodes.assumptions });
  }
  if (nodes.ambiguities.length > 0) {
    await runCypher(ATTACH_AMBIGUITIES(parent), { ...ctx, items: nodes.ambiguities });
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

const SUBSTRATE_RELS = [
  "CONTAINS_LITERAL",
  "HAS_SIDE_EFFECT",
  "HAS_EDGE_CASE",
  "HAS_BOUNDARY",
  "HANDLES_ERROR",
  "HAS_INVARIANT",
  "HAS_DIAGNOSTIC_NOTE",
  "HAS_ASSUMPTION",
  "HAS_AMBIGUITY",
];

function CLEAR_SUBSTRATE_EDGES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
OPTIONAL MATCH (p)-[r:${SUBSTRATE_RELS.join("|")}]->()
DELETE r`;
}

function ATTACH_VERBATIM(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (v:VerbatimLiteral {kind: it.kind, hash: it.hash})
SET v.value = it.value
MERGE (p)-[r:CONTAINS_LITERAL]->(v)
SET r.context = it.context,
    r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_SIDE_EFFECTS(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (s:SideEffect {category: it.category, value: it.value})
MERGE (p)-[:HAS_SIDE_EFFECT]->(s)`;
}

function ATTACH_EDGE_CASES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (e:EdgeCase {hash: it.hash})
SET e.inputShape = it.inputShape,
    e.behavior = it.behavior
MERGE (p)-[r:HAS_EDGE_CASE]->(e)
SET r.handled = it.handled,
    r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_BOUNDARIES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (b:BoundaryCondition {hash: it.hash})
SET b.operator = it.operator,
    b.left = it.left,
    b.right = it.right,
    b.inclusive = it.inclusive,
    b.intent = it.intent
MERGE (p)-[r:HAS_BOUNDARY]->(b)
SET r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_ERROR_HANDLING(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (e:ErrorHandlingItem {hash: it.hash})
SET e.thrown = it.thrown,
    e.caught = it.caught,
    e.action = it.action,
    e.fallback = it.fallback
MERGE (p)-[r:HANDLES_ERROR]->(e)
SET r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_INVARIANTS(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (i:Invariant {hash: it.hash})
SET i.kind = it.kind,
    i.description = it.description
MERGE (p)-[r:HAS_INVARIANT]->(i)
SET r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_DIAGNOSTIC_NOTES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (d:DiagnosticNote {hash: it.hash})
SET d.category = it.category,
    d.description = it.description
MERGE (p)-[r:HAS_DIAGNOSTIC_NOTE]->(d)
SET r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_ASSUMPTIONS(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (a:Assumption {hash: it.hash})
SET a.kind = it.kind,
    a.description = it.description
MERGE (p)-[r:HAS_ASSUMPTION]->(a)
SET r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}

function ATTACH_AMBIGUITIES(parent: IrParentRef): string {
  return `${parentMatch(parent)}
UNWIND $items AS it
MERGE (a:Ambiguity {hash: it.hash})
SET a.question = it.question,
    a.affects = it.affects
MERGE (p)-[r:HAS_AMBIGUITY]->(a)
SET r.resolution = it.resolution,
    r.anchorStart = it.anchorStart,
    r.anchorEnd = it.anchorEnd`;
}
