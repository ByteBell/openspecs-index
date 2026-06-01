import { runCypher } from "@bb/neo4j";
import type { IrUnitGraphEdges } from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Writes `:CALLS` and `:FLOWS_TO` edges between `:CodeUnit` nodes from the
 * file's local call/data-flow graphs. Endpoints (`caller`/`callee`,
 * `producer`/`consumer`) are matched by qualified name within this knowledge
 * graph; when no `:CodeUnit` matches we fall back to MERGEing a global
 * `:UnresolvedCallee {name}` placeholder so the edge still lands and a later
 * pass (cross-file resolution, mcp-enrichment) can promote it.
 *
 * Run after `writeCodeUnits` for both the parent file and any chunk siblings,
 * so the endpoints exist.
 */
export async function writeUnitGraphEdges(
  knowledgeId: string,
  edges: IrUnitGraphEdges,
): Promise<void> {
  if (edges.calls.length > 0) {
    await runCypher(UPSERT_CALL_EDGES, { knowledgeId, edges: edges.calls });
  }
  if (edges.flows.length > 0) {
    await runCypher(UPSERT_FLOW_EDGES, { knowledgeId, edges: edges.flows });
  }
}

const UPSERT_CALL_EDGES = `
UNWIND $edges AS e
OPTIONAL MATCH (caller:CodeUnit {knowledgeId: $knowledgeId, qualifiedName: e.caller})
OPTIONAL MATCH (callee:CodeUnit {knowledgeId: $knowledgeId, qualifiedName: e.callee})
FOREACH (_ IN CASE WHEN caller IS NOT NULL AND callee IS NOT NULL THEN [1] ELSE [] END |
  MERGE (caller)-[r:CALLS {kind: e.kind, anchorStart: e.anchorStart, anchorEnd: e.anchorEnd}]->(callee)
  SET r.origin = e.origin
)
FOREACH (_ IN CASE WHEN caller IS NOT NULL AND callee IS NULL THEN [1] ELSE [] END |
  MERGE (uc:UnresolvedCallee {name: e.callee})
  MERGE (caller)-[r:CALLS {kind: e.kind, anchorStart: e.anchorStart, anchorEnd: e.anchorEnd}]->(uc)
  SET r.origin = e.origin
)
`;

const UPSERT_FLOW_EDGES = `
UNWIND $edges AS e
OPTIONAL MATCH (producer:CodeUnit {knowledgeId: $knowledgeId, qualifiedName: e.producer})
OPTIONAL MATCH (consumer:CodeUnit {knowledgeId: $knowledgeId, qualifiedName: e.consumer})
FOREACH (_ IN CASE WHEN producer IS NOT NULL AND consumer IS NOT NULL THEN [1] ELSE [] END |
  MERGE (producer)-[r:FLOWS_TO {payload: e.payload, anchorStart: e.anchorStart, anchorEnd: e.anchorEnd}]->(consumer)
  SET r.transformation = e.transformation
)
FOREACH (_ IN CASE WHEN producer IS NOT NULL AND consumer IS NULL THEN [1] ELSE [] END |
  MERGE (uc:UnresolvedCallee {name: e.consumer})
  MERGE (producer)-[r:FLOWS_TO {payload: e.payload, anchorStart: e.anchorStart, anchorEnd: e.anchorEnd}]->(uc)
  SET r.transformation = e.transformation
)
`;
