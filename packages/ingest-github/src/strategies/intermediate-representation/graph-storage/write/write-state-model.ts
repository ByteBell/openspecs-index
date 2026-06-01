import { runCypher } from "@bb/neo4j";
import type {
  IrParentRef,
  IrStateModelBag,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Writes a `:StateModel` per file/chunk plus one `:State` per distinct state name
 * and one `:TRANSITIONS_TO` edge per transition. No-op when the IR record had no
 * state model (`bag === null`).
 */
export async function writeStateModel(parent: IrParentRef, bag: IrStateModelBag | null): Promise<void> {
  if (bag === null || bag.states.length === 0) {
    await runCypher(CLEAR_STATE_MODEL(parent), parentContext(parent));
    return;
  }
  const ctx = parentContext(parent);
  const fileId = parent.fileId;

  await runCypher(CLEAR_STATE_MODEL(parent), ctx);
  await runCypher(UPSERT_STATE_MODEL(parent), { ...ctx, fileId });
  await runCypher(ATTACH_STATES, {
    knowledgeId: parent.knowledgeId,
    fileId,
    states: bag.states,
  });
  if (bag.transitions.length > 0) {
    await runCypher(ATTACH_TRANSITIONS, {
      knowledgeId: parent.knowledgeId,
      fileId,
      transitions: bag.transitions,
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

function CLEAR_STATE_MODEL(parent: IrParentRef): string {
  return `${parentMatch(parent)}
OPTIONAL MATCH (p)-[r:HAS_STATE_MODEL]->(sm:StateModel)
OPTIONAL MATCH (sm)-[r2:HAS_STATE]->(s:State)
OPTIONAL MATCH (s)-[r3:TRANSITIONS_TO]->(:State)
DELETE r3, r2, r, sm, s`;
}

function UPSERT_STATE_MODEL(parent: IrParentRef): string {
  return `${parentMatch(parent)}
MERGE (sm:StateModel {knowledgeId: $knowledgeId, fileId: $fileId})
MERGE (p)-[:HAS_STATE_MODEL]->(sm)`;
}

const ATTACH_STATES = `
MATCH (sm:StateModel {knowledgeId: $knowledgeId, fileId: $fileId})
UNWIND $states AS st
MERGE (s:State {knowledgeId: $knowledgeId, fileId: $fileId, name: st.name})
SET s.initial = st.initial,
    s.terminal = st.terminal
MERGE (sm)-[:HAS_STATE]->(s)
`;

const ATTACH_TRANSITIONS = `
UNWIND $transitions AS t
MATCH (from:State {knowledgeId: $knowledgeId, fileId: $fileId, name: t.fromState})
MATCH (to:State {knowledgeId: $knowledgeId, fileId: $fileId, name: t.toState})
MERGE (from)-[r:TRANSITIONS_TO {trigger: t.trigger}]->(to)
SET r.guard = t.guard,
    r.effect = t.effect,
    r.anchorStart = t.anchorStart,
    r.anchorEnd = t.anchorEnd
`;
