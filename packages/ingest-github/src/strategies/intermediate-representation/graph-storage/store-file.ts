import type { IrFileAnalysisRecord } from "#src/strategies/intermediate-representation/records.ts";
import { projectFileNodeBag } from "#src/strategies/intermediate-representation/graph-storage/project/project-file-node.ts";
import { projectConceptEdges } from "#src/strategies/intermediate-representation/graph-storage/project/project-concept-edges.ts";
import { projectStructuralNodes } from "#src/strategies/intermediate-representation/graph-storage/project/project-structural-nodes.ts";
import { projectSubstrate } from "#src/strategies/intermediate-representation/graph-storage/project/project-substrate.ts";
import { projectStateModel } from "#src/strategies/intermediate-representation/graph-storage/project/project-state-model.ts";
import { projectUnitGraphEdges } from "#src/strategies/intermediate-representation/graph-storage/project/project-call-graph.ts";
import { projectCodeUnitBags } from "#src/strategies/intermediate-representation/graph-storage/project/project-units.ts";
import { writeFileNode } from "#src/strategies/intermediate-representation/graph-storage/write/write-file.ts";
import { writeConceptEdges } from "#src/strategies/intermediate-representation/graph-storage/write/write-concepts.ts";
import { writeStructuralNodes } from "#src/strategies/intermediate-representation/graph-storage/write/write-structural.ts";
import { writeSubstrateNodes } from "#src/strategies/intermediate-representation/graph-storage/write/write-substrate.ts";
import { writeStateModel } from "#src/strategies/intermediate-representation/graph-storage/write/write-state-model.ts";
import { writeCodeUnits } from "#src/strategies/intermediate-representation/graph-storage/write/write-units.ts";
import { writeUnitGraphEdges } from "#src/strategies/intermediate-representation/graph-storage/write/write-call-graph.ts";
import type {
  IrGraphStorageContext,
  IrParentRef,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Stores one small-file IR analysis into Neo4j. Order matters: the `:File` node
 * is upserted first (so subsequent edges can MATCH it), then concept/structural/
 * substrate/state edges from `:File`, then `:CodeUnit` nodes, then call/flow
 * edges between those units (last so endpoints exist).
 *
 * Idempotent: re-calling with the same record (or a re-analysis at the same
 * commit) is a no-op for the `:File` node and a re-build of its IR edges.
 */
export async function storeIrFileAnalysis(
  ctx: IrGraphStorageContext,
  record: IrFileAnalysisRecord,
): Promise<void> {
  const parent: IrParentRef = {
    scope: "file",
    knowledgeId: ctx.knowledgeId,
    relativePath: record.relativePath,
    chunkIndex: null,
    fileId: ctx.fileId,
  };

  await writeFileNode(projectFileNodeBag(ctx, record, false, 0));

  const m = record.analysis.module;
  await writeConceptEdges(parent, projectConceptEdges(m));
  await writeStructuralNodes(parent, projectStructuralNodes(m));
  await writeSubstrateNodes(parent, projectSubstrate(m));
  await writeStateModel(parent, projectStateModel(m));

  await writeCodeUnits(parent, projectCodeUnitBags(ctx, parent, record.analysis.units));
  await writeUnitGraphEdges(ctx.knowledgeId, projectUnitGraphEdges(m));
}
