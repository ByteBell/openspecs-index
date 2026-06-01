/**
 * Core identity + node bags for the IR graph writer. The bigger nested-array
 * substrate / concept / structural / state bags live in sibling files in this
 * folder; the parent `types.ts` re-exports everything as one flat surface.
 */

export interface IrGraphStorageContext {
  orgId: string;
  knowledgeId: string;
  repoId: string;
  commitHash: string | null;
  fileId: string;
}

export type IrParentScope = "file" | "chunk";

export interface IrParentRef {
  scope: IrParentScope;
  knowledgeId: string;
  relativePath: string;
  chunkIndex: number | null;
  fileId: string;
}

/** Property bag for the `:File` node (identity + scalars + singleton bundles). */
export interface IrFileNodeBag {
  orgId: string;
  knowledgeId: string;
  repoId: string;
  commitHash: string | null;
  relativePath: string;
  fileId: string;
  language: string;
  sha256: string;
  sizeBytes: number;
  tokenCount: number;
  isBigFile: boolean;
  totalChunks: number;
  semanticFingerprint: string;
  analysedAt: string;
  model: string;

  purpose: string;
  summary: string;
  businessContext: string;
  representationFamily: string;
  representationType: string;
  moduleLevelCode: string | null;
  canonicalParagraph: string;
  canonicalTokenEstimate: number;

  concurrencyKind: string;
  concurrencyReentrant: boolean;
  concurrencyOrdering: string;
  concurrencyNotes: string;

  fpLineCount: number;
  fpDeclarationCount: number;
  fpMaxNestingDepth: number;
  fpRoughCyclomatic: number;

  hintNamingStyle: string;
  hintReturnStyle: string;
  hintCommentStyle: string;
  hintDialect: string;
}

export interface IrChunkNodeBag extends Omit<IrFileNodeBag, "isBigFile" | "totalChunks"> {
  chunkIndex: number;
  totalChunks: number;
  startLine: number;
  endLine: number;
  parentRelativePath: string;
}

export interface IrCodeUnitNodeBag {
  knowledgeId: string;
  orgId: string;
  parentScope: IrParentScope;
  parentRelativePath: string;
  parentChunkIndex: number | null;
  unitId: string;
  fileId: string;
  unitKind: string;
  name: string;
  qualifiedName: string;
  parentUnitId: string | null;
  startLine: number;
  endLine: number;
  isBehavioral: boolean;
}
