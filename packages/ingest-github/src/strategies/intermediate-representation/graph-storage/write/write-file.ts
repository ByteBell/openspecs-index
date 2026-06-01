import { runCypher } from "@bb/neo4j";
import type {
  IrChunkNodeBag,
  IrFileNodeBag,
} from "#src/strategies/intermediate-representation/graph-storage/types.ts";

const UPSERT_KNOWLEDGE = `
MERGE (k:Knowledge {knowledgeId: $knowledgeId})
`;

const UPSERT_FILE = `
MERGE (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
SET f:IrFile,
    f.orgId = $orgId,
    f.repoId = $repoId,
    f.commitHash = $commitHash,
    f.fileId = $fileId,
    f.language = $language,
    f.sha = $sha256,
    f.sizeBytes = $sizeBytes,
    f.tokenCount = $tokenCount,
    f.isBigFile = $isBigFile,
    f.totalChunks = $totalChunks,
    f.semanticFingerprint = $semanticFingerprint,
    f.analysedAt = $analysedAt,
    f.model = $model,
    f.analysisStrategy = 'ir',
    f.purpose = $purpose,
    f.summary = $summary,
    f.businessContext = $businessContext,
    f.representationFamily = $representationFamily,
    f.representationType = $representationType,
    f.moduleLevelCode = $moduleLevelCode,
    f.canonicalParagraph = $canonicalParagraph,
    f.canonicalTokenEstimate = $canonicalTokenEstimate,
    f.concurrencyKind = $concurrencyKind,
    f.concurrencyReentrant = $concurrencyReentrant,
    f.concurrencyOrdering = $concurrencyOrdering,
    f.concurrencyNotes = $concurrencyNotes,
    f.fpLineCount = $fpLineCount,
    f.fpDeclarationCount = $fpDeclarationCount,
    f.fpMaxNestingDepth = $fpMaxNestingDepth,
    f.fpRoughCyclomatic = $fpRoughCyclomatic,
    f.hintNamingStyle = $hintNamingStyle,
    f.hintReturnStyle = $hintReturnStyle,
    f.hintCommentStyle = $hintCommentStyle,
    f.hintDialect = $hintDialect,
    f.updatedAt = $analysedAt
WITH f
MATCH (k:Knowledge {knowledgeId: $knowledgeId})
MERGE (k)-[:HAS_FILE]->(f)
`;

const UPSERT_CHUNK = `
MERGE (c:Chunk {knowledgeId: $knowledgeId, relativePath: $relativePath, chunkIndex: $chunkIndex})
SET c.orgId = $orgId,
    c.repoId = $repoId,
    c.commitHash = $commitHash,
    c.fileId = $fileId,
    c.parentRelativePath = $parentRelativePath,
    c.language = $language,
    c.sha = $sha256,
    c.sizeBytes = $sizeBytes,
    c.tokenCount = $tokenCount,
    c.totalChunks = $totalChunks,
    c.startLine = $startLine,
    c.endLine = $endLine,
    c.semanticFingerprint = $semanticFingerprint,
    c.analysedAt = $analysedAt,
    c.model = $model,
    c.purpose = $purpose,
    c.summary = $summary,
    c.businessContext = $businessContext,
    c.representationFamily = $representationFamily,
    c.representationType = $representationType,
    c.moduleLevelCode = $moduleLevelCode,
    c.canonicalParagraph = $canonicalParagraph,
    c.canonicalTokenEstimate = $canonicalTokenEstimate,
    c.concurrencyKind = $concurrencyKind,
    c.concurrencyReentrant = $concurrencyReentrant,
    c.concurrencyOrdering = $concurrencyOrdering,
    c.concurrencyNotes = $concurrencyNotes,
    c.fpLineCount = $fpLineCount,
    c.fpDeclarationCount = $fpDeclarationCount,
    c.fpMaxNestingDepth = $fpMaxNestingDepth,
    c.fpRoughCyclomatic = $fpRoughCyclomatic,
    c.hintNamingStyle = $hintNamingStyle,
    c.hintReturnStyle = $hintReturnStyle,
    c.hintCommentStyle = $hintCommentStyle,
    c.hintDialect = $hintDialect,
    c.updatedAt = $analysedAt
WITH c
MATCH (f:File {knowledgeId: $knowledgeId, relativePath: $parentRelativePath})
MERGE (f)-[:HAS_CHUNK]->(c)
`;

const UPSERT_BIG_FILE_HEADER = `
MERGE (f:File {knowledgeId: $knowledgeId, relativePath: $relativePath})
SET f:IrFile,
    f.orgId = $orgId,
    f.repoId = $repoId,
    f.commitHash = $commitHash,
    f.fileId = $fileId,
    f.language = $language,
    f.sha = $sha256,
    f.sizeBytes = $sizeBytes,
    f.tokenCount = $tokenCount,
    f.isBigFile = true,
    f.totalChunks = $totalChunks,
    f.analysisStrategy = 'ir',
    f.updatedAt = $analysedAt
WITH f
MATCH (k:Knowledge {knowledgeId: $knowledgeId})
MERGE (k)-[:HAS_FILE]->(f)
`;

/** MERGEs the `:Knowledge {knowledgeId}` placeholder. Safe to call repeatedly. */
export async function ensureKnowledgeNode(knowledgeId: string): Promise<void> {
  await runCypher(UPSERT_KNOWLEDGE, { knowledgeId });
}

/** Upserts the `:File` node + parent `:Knowledge` HAS_FILE edge for a small file. */
export async function writeFileNode(bag: IrFileNodeBag): Promise<void> {
  await ensureKnowledgeNode(bag.knowledgeId);
  await runCypher(UPSERT_FILE, bag as unknown as Record<string, unknown>);
}

/**
 * Upserts a header-only `:File` for a big file (identity + flags only — semantic
 * fields live on its `:Chunk` children). Run once per big file before writing
 * any chunk.
 */
export async function writeBigFileHeader(
  knowledgeId: string,
  orgId: string,
  repoId: string,
  commitHash: string | null,
  fileId: string,
  relativePath: string,
  language: string,
  sha256: string,
  sizeBytes: number,
  tokenCount: number,
  totalChunks: number,
  analysedAt: string,
): Promise<void> {
  await ensureKnowledgeNode(knowledgeId);
  await runCypher(UPSERT_BIG_FILE_HEADER, {
    knowledgeId,
    orgId,
    repoId,
    commitHash,
    fileId,
    relativePath,
    language,
    sha256,
    sizeBytes,
    tokenCount,
    totalChunks,
    analysedAt,
  });
}

/** Upserts one `:Chunk` and the parent `:File`-[:HAS_CHUNK]->`:Chunk` edge. */
export async function writeChunkNode(bag: IrChunkNodeBag): Promise<void> {
  await runCypher(UPSERT_CHUNK, bag as unknown as Record<string, unknown>);
}
