import type { IrFileAnalysisRecord } from "#src/strategies/intermediate-representation/records.ts";
import { projectChunkNodeBag } from "#src/strategies/intermediate-representation/graph-storage/project/project-file-node.ts";
import { projectConceptEdges } from "#src/strategies/intermediate-representation/graph-storage/project/project-concept-edges.ts";
import { projectStructuralNodes } from "#src/strategies/intermediate-representation/graph-storage/project/project-structural-nodes.ts";
import { projectSubstrate } from "#src/strategies/intermediate-representation/graph-storage/project/project-substrate.ts";
import { projectStateModel } from "#src/strategies/intermediate-representation/graph-storage/project/project-state-model.ts";
import { projectUnitGraphEdges } from "#src/strategies/intermediate-representation/graph-storage/project/project-call-graph.ts";
import { projectCodeUnitBags } from "#src/strategies/intermediate-representation/graph-storage/project/project-units.ts";
import {
  writeBigFileHeader,
  writeChunkNode,
} from "#src/strategies/intermediate-representation/graph-storage/write/write-file.ts";
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
 * Stores one big-file chunk's IR analysis into Neo4j. Each chunk produces a
 * `:Chunk` node hanging off the parent `:File` header, plus its own concept/
 * structural/substrate/state edges and `:CodeUnit` children. The parent `:File`
 * header is upserted on the first chunk (idempotent if already present).
 */
export async function storeIrChunkAnalysis(
  ctx: IrGraphStorageContext,
  record: IrFileAnalysisRecord,
  chunkIndex: number,
  totalChunks: number,
  startLine: number,
  endLine: number,
): Promise<void> {
  await writeBigFileHeader(
    ctx.knowledgeId,
    ctx.orgId,
    ctx.repoId,
    ctx.commitHash,
    ctx.fileId,
    record.relativePath,
    record.language,
    record.sha256,
    record.sizeBytes,
    record.tokenCount,
    totalChunks,
    record.analysedAt,
  );

  const chunkBag = projectChunkNodeBag(ctx, record, chunkIndex, totalChunks, startLine, endLine);
  await writeChunkNode(chunkBag);

  const parent: IrParentRef = {
    scope: "chunk",
    knowledgeId: ctx.knowledgeId,
    relativePath: record.relativePath,
    chunkIndex,
    fileId: chunkBag.fileId,
  };

  const m = record.analysis.module;
  await writeConceptEdges(parent, projectConceptEdges(m));
  await writeStructuralNodes(parent, projectStructuralNodes(m));
  await writeSubstrateNodes(parent, projectSubstrate(m));
  await writeStateModel(parent, projectStateModel(m));

  await writeCodeUnits(parent, projectCodeUnitBags(ctx, parent, record.analysis.units));
  await writeUnitGraphEdges(ctx.knowledgeId, projectUnitGraphEdges(m));
}
