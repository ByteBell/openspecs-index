import type { ModuleIr } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type { IrFileAnalysisRecord } from "#src/strategies/intermediate-representation/records.ts";
import type {
  IrChunkNodeBag,
  IrFileNodeBag,
  IrGraphStorageContext,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

/**
 * Projects record + ModuleIr into the property bag for a `:File` node. Only the
 * identity, big-file flags, scalar SemanticFields, and three singleton bundles
 * (concurrencyModel, fileFingerprint, reconstructionHints) land here — every
 * shareable list is taken out and projected into its own node/edge bag by the
 * sibling projector modules.
 */
export function projectFileNodeBag(
  ctx: IrGraphStorageContext,
  record: IrFileAnalysisRecord,
  isBigFile: boolean,
  totalChunks: number,
): IrFileNodeBag {
  const m = record.analysis.module;
  return {
    orgId: ctx.orgId,
    knowledgeId: ctx.knowledgeId,
    repoId: ctx.repoId,
    commitHash: ctx.commitHash,
    relativePath: record.relativePath,
    fileId: ctx.fileId,
    language: record.language,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    tokenCount: record.tokenCount,
    isBigFile,
    totalChunks,
    semanticFingerprint: m.semanticFingerprint,
    analysedAt: record.analysedAt,
    model: record.model,
    ...scalarFields(m),
    ...singletonBundles(m),
  };
}

/**
 * Projects record + per-chunk ModuleIr into the property bag for a `:Chunk` node.
 * Same shape as the file bag plus the chunk's line range and ordering.
 */
export function projectChunkNodeBag(
  ctx: IrGraphStorageContext,
  record: IrFileAnalysisRecord,
  chunkIndex: number,
  totalChunks: number,
  startLine: number,
  endLine: number,
): IrChunkNodeBag {
  const m = record.analysis.module;
  return {
    orgId: ctx.orgId,
    knowledgeId: ctx.knowledgeId,
    repoId: ctx.repoId,
    commitHash: ctx.commitHash,
    relativePath: record.relativePath,
    parentRelativePath: record.relativePath,
    fileId: `${ctx.fileId}:L${startLine}-${endLine}`,
    language: record.language,
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    tokenCount: record.tokenCount,
    chunkIndex,
    totalChunks,
    startLine,
    endLine,
    semanticFingerprint: m.semanticFingerprint,
    analysedAt: record.analysedAt,
    model: record.model,
    ...scalarFields(m),
    ...singletonBundles(m),
  };
}

type ScalarBundle = Pick<
  IrFileNodeBag,
  | "purpose"
  | "summary"
  | "businessContext"
  | "representationFamily"
  | "representationType"
  | "moduleLevelCode"
  | "canonicalParagraph"
  | "canonicalTokenEstimate"
>;

function scalarFields(m: ModuleIr): ScalarBundle {
  return {
    purpose: m.purpose,
    summary: m.summary,
    businessContext: m.businessContext,
    representationFamily: m.representationFamily,
    representationType: m.representationType,
    moduleLevelCode: m.moduleLevelCode,
    canonicalParagraph: m.canonicalCentroid.paragraph,
    canonicalTokenEstimate: m.canonicalCentroid.tokenEstimate,
  };
}

type SingletonBundle = Pick<
  IrFileNodeBag,
  | "concurrencyKind"
  | "concurrencyReentrant"
  | "concurrencyOrdering"
  | "concurrencyNotes"
  | "fpLineCount"
  | "fpDeclarationCount"
  | "fpMaxNestingDepth"
  | "fpRoughCyclomatic"
  | "hintNamingStyle"
  | "hintReturnStyle"
  | "hintCommentStyle"
  | "hintDialect"
>;

function singletonBundles(m: ModuleIr): SingletonBundle {
  return {
    concurrencyKind: m.concurrencyModel.kind,
    concurrencyReentrant: m.concurrencyModel.reentrant,
    concurrencyOrdering: m.concurrencyModel.ordering,
    concurrencyNotes: m.concurrencyModel.notes,
    fpLineCount: m.fileFingerprint.lineCount,
    fpDeclarationCount: m.fileFingerprint.declarationCount,
    fpMaxNestingDepth: m.fileFingerprint.maxNestingDepth,
    fpRoughCyclomatic: m.fileFingerprint.roughCyclomatic,
    hintNamingStyle: m.reconstructionHints.namingStyle,
    hintReturnStyle: m.reconstructionHints.returnStyle,
    hintCommentStyle: m.reconstructionHints.commentStyle,
    hintDialect: m.reconstructionHints.dialect,
  };
}
