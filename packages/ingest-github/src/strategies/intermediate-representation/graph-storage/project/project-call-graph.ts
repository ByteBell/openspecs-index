import type { ModuleIr } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type {
  IrCallEdgeBag,
  IrFlowEdgeBag,
  IrUnitGraphEdges,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Projects `localCallGraph` and `dataFlowGraph` into edge bags ready for the
 * writer to MERGE between `:CodeUnit` nodes. The `caller`/`callee` (and
 * `producer`/`consumer`) strings are the unit qualified names the file-analysis
 * pass produced — the writer looks them up by `(knowledgeId, qualifiedName)`
 * and falls back to a global `:UnresolvedCallee {name}` when no unit matches
 * (e.g. for cross-file or stdlib calls).
 */
export function projectUnitGraphEdges(m: ModuleIr): IrUnitGraphEdges {
  return {
    calls: m.localCallGraph.map(projectCallEdge),
    flows: m.dataFlowGraph.map(projectFlowEdge),
  };
}

function projectCallEdge(e: ModuleIr["localCallGraph"][number]): IrCallEdgeBag {
  return {
    caller: e.caller,
    callee: e.callee,
    origin: e.origin,
    kind: e.kind,
    anchorStart: e.anchor.startLine,
    anchorEnd: e.anchor.endLine,
  };
}

function projectFlowEdge(e: ModuleIr["dataFlowGraph"][number]): IrFlowEdgeBag {
  return {
    producer: e.producer,
    consumer: e.consumer,
    payload: e.payload,
    transformation: e.transformation,
    anchorStart: e.anchor.startLine,
    anchorEnd: e.anchor.endLine,
  };
}
