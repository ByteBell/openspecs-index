import { Config, type UpsertFileNodeInput } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import { filesGraph, indexesGraph } from "@bb/graph-db";
import type { NodeScope } from "@bb/graph-core";
import type { MetaPaths } from "@bb/ingest-core";
import { throwIfCancelled } from "@bb/ingest-core";
import type { FileAnalysisCache } from "@bb/ingest-core";
import { languageFromPath } from "@bb/ingest-core";
import type { ProgressContext } from "@bb/ingest-core";

// ─────────────────────────────────────────────────────────────────────────────
// ConceptGraphStrategy storage phase. Mirrors `phases/store-flat-analysis.ts`
// but writes only `:File` (+ the existing reverse-linked `:Keyword` /
// `:Class` / `:Function` / `:Module` nodes attached by `filesGraph`). No
// `:Repo`, no `:Folder`, no folder-summary upserts. The conceptual layer
// that replaces folder grouping is added by the per-file enrichment phase
// that runs after this — `:Concept` / `:Contract` / `:Guidepost` nodes
// land in a separate pass.
//
// We deliberately omit `folderPath` from each `UpsertFileNodeInput`; the
// neo4j adapter skips the file-to-folder edge attach when no folder pairs
// are provided. The :Knowledge → :HAS_FILE edge is still written by the
// underlying upsert, so files remain reachable via their knowledge.
// ─────────────────────────────────────────────────────────────────────────────

export interface StoreFilesNoFoldersInput {
  scope: NodeScope;
  metaPaths: MetaPaths;
  cache: FileAnalysisCache;
  progressContext?: ProgressContext;
}

export interface StoreFilesNoFoldersResult {
  nodesWritten: number;
  filesWritten: number;
}

export async function storeFilesNoFolders(input: StoreFilesNoFoldersInput): Promise<StoreFilesNoFoldersResult> {
  throwIfCancelled(input.scope.knowledgeId);
  // Concept-graph schema is additive to the base knowledge indexes; ensure
  // both. ensureKnowledgeIndexes is also called at server boot, so this is
  // mostly defensive — ensureConceptGraphIndexes is the new one we own.
  await indexesGraph.ensureConceptGraphIndexes();

  const batchSize = getConfigValue(Config.Neo4jBatchSize);

  const fileInputs: UpsertFileNodeInput[] = [];
  for (const file of input.cache.values()) {
    fileInputs.push({
      orgId: input.scope.orgId,
      knowledgeId: input.scope.knowledgeId,
      repoId: input.scope.repoId,
      relativePath: file.relativePath,
      language: file.language.length > 0 ? file.language : languageFromPath(file.relativePath),
      sha: file.sha256,
      sizeBytes: file.sizeBytes,
      analysis: file.analysis,
      isBigFile: file.isBigFile,
      totalChunks: file.totalChunks,
      totalTokenCount: file.totalTokenCount,
    });
  }

  const fileReporter = input.progressContext?.reporter({
    phase: "indexing",
    subPhase: "files",
    total: { kind: "fixed", total: fileInputs.length },
  });
  await fileReporter?.start();

  let filesWritten = 0;
  try {
    logger.info(
      `concept-graph: file upsert dispatching ${Math.ceil(fileInputs.length / batchSize)} batches of up to ${batchSize} files (total=${fileInputs.length})`,
    );
    for (let i = 0; i < fileInputs.length; i += batchSize) {
      throwIfCancelled(input.scope.knowledgeId);
      const batch = fileInputs.slice(i, i + batchSize);
      await filesGraph.upsertFileNodesBatch(batch);
      filesWritten += batch.length;
      for (const item of batch) {
        fileReporter?.increment(1, { fileName: item.relativePath });
      }
    }
  } finally {
    fileReporter?.stop();
  }

  logger.info(`concept-graph: store-files-no-folders done: filesWritten=${filesWritten}`);
  return { nodesWritten: filesWritten, filesWritten };
}
