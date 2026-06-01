import type { UnitDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type {
  IrCodeUnitNodeBag,
  IrGraphStorageContext,
  IrParentRef,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Projects the lightweight `UnitDescriptor[]` produced by file-analysis pass-1
 * into `:CodeUnit` node bags. Deep `CodeUnit` IR from the reconstruction phase
 * (signature, parameters, logicOutline, verbatimBlocks, …) is NOT projected here;
 * a follow-up writer will SET those properties additively on the same node.
 *
 * `parentRef` discriminates whether the units hang off a `:File` or `:Chunk`.
 */
export function projectCodeUnitBags(
  ctx: IrGraphStorageContext,
  parentRef: IrParentRef,
  units: ReadonlyArray<UnitDescriptor>,
): IrCodeUnitNodeBag[] {
  return units.map((u) => ({
    knowledgeId: ctx.knowledgeId,
    orgId: ctx.orgId,
    parentScope: parentRef.scope,
    parentRelativePath: parentRef.relativePath,
    parentChunkIndex: parentRef.chunkIndex,
    unitId: u.unitId,
    fileId: parentRef.fileId,
    unitKind: u.unitKind,
    name: u.name,
    qualifiedName: u.qualifiedName,
    parentUnitId: u.parentUnitId,
    startLine: u.startLine,
    endLine: u.endLine,
    isBehavioral: u.isBehavioral,
  }));
}
