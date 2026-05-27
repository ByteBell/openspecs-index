import { readFile } from "node:fs/promises";
import { Config, type UpsertFolderNodeInput, type UpsertFileNodeInput } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import { repoGraph, indexesGraph, foldersGraph, filesGraph } from "@bb/graph-db";
import type { GithubIndexPayload } from "@bb/types";
import type { NodeScope } from "@bb/graph-core";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import { throwIfCancelled } from "#src/pipeline/cancellation.ts";
import type { FileAnalysisCache } from "#src/strategies/flat-folder/file-analysis-cache.ts";
import { iterateFolderSummaries } from "#src/strategies/flat-folder/folder-summary.ts";
import { directFolderOf } from "#src/strategies/flat-folder/folder-path.ts";
import { languageFromPath } from "#src/adapters/llm-file-analyzer.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import type { FolderSummary, RepoSummary, RepoSummaryEnvelope } from "#src/strategies/flat-folder/types.ts";

export interface StoreFlatAnalysisInput {
  scope: NodeScope;
  payload: GithubIndexPayload;
  branch: string;
  metaPaths: MetaPaths;
  cache: FileAnalysisCache;
  progressContext?: ProgressContext;
}

export interface StoreFlatAnalysisResult {
  nodesWritten: number;
  foldersWritten: number;
  filesWritten: number;
}

export async function storeFlatAnalysis(input: StoreFlatAnalysisInput): Promise<StoreFlatAnalysisResult> {
  throwIfCancelled(input.scope.knowledgeId);
  await indexesGraph.ensureFlatFolderIndexes();

  const batchSize = getConfigValue(Config.Neo4jBatchSize);

  // 1. :Repo node — single upsert, not batched (one repo per knowledge).
  let nodesWritten = 0;
  const repoSummary = await readRepoSummary(input.metaPaths);
  if (repoSummary !== null) {
    await repoGraph.upsertRepoNode({
      scope: input.scope,
      repoUrl: input.payload.repoUrl,
      branch: input.branch,
      summary: {
        purpose: repoSummary.purpose,
        summary: repoSummary.summary,
        keywords: repoSummary.keywords,
        architecture: repoSummary.architecture,
        dataFlow: repoSummary.dataFlow,
        majorSubsystems: repoSummary.majorSubsystems,
        keyPatterns: repoSummary.keyPatterns,
      },
    });
  } else {
    logger.warn(`phase7: no repo summary on disk; writing :Repo with empty summary`);
    await repoGraph.upsertRepoNode({
      scope: input.scope,
      repoUrl: input.payload.repoUrl,
      branch: input.branch,
      summary: emptyRepoSummaryPayload(),
    });
  }
  nodesWritten += 1;

  // 2. Collect every folder we'll upsert: the on-disk folder summaries plus
  // synthesised parents for any file whose folder didn't get a summary. Doing
  // this up front gives both reporters real fixed totals so `overallProgress`
  // doesn't leap to 100 the moment the folder loop completes (the previous
  // UX bug where the file sub-phase registered too late to dilute the
  // indexing aggregate).
  const folderInputs: UpsertFolderNodeInput[] = [];
  const folderPaths = new Set<string>();
  for await (const folder of iterateFolderSummaries(input.metaPaths)) {
    folderInputs.push({
      scope: input.scope,
      folderPath: folder.folderPath,
      summary: shapeFolderPayload(folder),
    });
    folderPaths.add(folder.folderPath);
  }
  for (const file of input.cache.values()) {
    const folderPath = directFolderOf(file.relativePath);
    if (!folderPaths.has(folderPath)) {
      folderInputs.push({
        scope: input.scope,
        folderPath,
        summary: emptyFolderPayload(),
      });
      folderPaths.add(folderPath);
    }
  }

  // 3. Both reporters open at phase entry with their true totals so the
  // overall-progress aggregate sees both denominators from the first tick.
  const folderReporter = input.progressContext?.reporter({
    phase: "indexing",
    subPhase: "folders",
    total: { kind: "fixed", total: folderInputs.length },
  });
  const fileReporter = input.progressContext?.reporter({
    phase: "indexing",
    subPhase: "files",
    total: { kind: "fixed", total: input.cache.size },
  });
  await folderReporter?.start();
  await fileReporter?.start();

  let foldersWritten = 0;
  let filesWritten = 0;
  try {
    // 4. Batched folder upserts.
    logger.info(
      `phase7: folder upsert dispatching ${Math.ceil(folderInputs.length / batchSize)} batches of up to ${batchSize} folders (total=${folderInputs.length})`,
    );
    for (let i = 0; i < folderInputs.length; i += batchSize) {
      throwIfCancelled(input.scope.knowledgeId);
      const batch = folderInputs.slice(i, i + batchSize);
      if (foldersGraph.upsertFolderNodesBatch) {
        await foldersGraph.upsertFolderNodesBatch(batch);
      } else {
        for (const item of batch) {
          await foldersGraph.upsertFolderNode(item);
        }
      }
      foldersWritten += batch.length;
      nodesWritten += batch.length;
      for (const item of batch) {
        folderReporter?.increment(1, { fileName: item.folderPath || "<root>" });
      }
    }

    // 5. File upsert stream.
    async function* yieldFiles() {
      for (const file of input.cache.values()) {
        throwIfCancelled(input.scope.knowledgeId);
        const upsertInput: UpsertFileNodeInput = {
          orgId: input.scope.orgId,
          knowledgeId: input.scope.knowledgeId,
          repoId: input.scope.repoId,
          relativePath: file.relativePath,
          folderPath: directFolderOf(file.relativePath),
          language: file.language.length > 0 ? file.language : languageFromPath(file.relativePath),
          sha: file.sha256,
          sizeBytes: file.sizeBytes,
          analysis: file.analysis,
          isBigFile: file.isBigFile,
          totalChunks: file.totalChunks,
          totalTokenCount: file.totalTokenCount,
        };
        filesWritten += 1;
        nodesWritten += 1;
        yield upsertInput;
        fileReporter?.increment(1, { fileName: file.relativePath });
      }
    }

    if (typeof filesGraph.bulkUpsertFiles === "function") {
      await filesGraph.bulkUpsertFiles(input.scope.knowledgeId, yieldFiles());
    } else if (typeof filesGraph.upsertFileNodesBatch === "function") {
      let batch: UpsertFileNodeInput[] = [];
      for await (const f of yieldFiles()) {
        batch.push(f);
        if (batch.length >= batchSize) {
          throwIfCancelled(input.scope.knowledgeId);
          await filesGraph.upsertFileNodesBatch(batch);
          batch = [];
        }
      }
      if (batch.length > 0) {
        throwIfCancelled(input.scope.knowledgeId);
        await filesGraph.upsertFileNodesBatch(batch);
      }
    } else {
      for await (const f of yieldFiles()) {
        await filesGraph.upsertFileNode(f);
      }
    }
  } finally {
    folderReporter?.stop();
    fileReporter?.stop();
  }

  logger.info(`phase7 done: nodesWritten=${nodesWritten} folders=${foldersWritten} files=${filesWritten}`);
  return { nodesWritten, foldersWritten, filesWritten };
}

function shapeFolderPayload(folder: FolderSummary): {
  purpose: string;
  summary: string;
  keywords: string[];
  classes: string[];
  functions: string[];
  importsInternal: string[];
  importsExternal: string[];
  dependencyGraph: string;
} {
  return {
    purpose: folder.purpose,
    summary: folder.summary,
    keywords: folder.keywords,
    classes: folder.classes,
    functions: folder.functions,
    importsInternal: folder.importsInternal,
    importsExternal: folder.importsExternal,
    dependencyGraph: folder.dependencyGraph,
  };
}

function emptyFolderPayload(): ReturnType<typeof shapeFolderPayload> {
  return {
    purpose: "",
    summary: "",
    keywords: [],
    classes: [],
    functions: [],
    importsInternal: [],
    importsExternal: [],
    dependencyGraph: "",
  };
}

function emptyRepoSummaryPayload(): {
  purpose: string;
  summary: string;
  keywords: string[];
  architecture: string;
  dataFlow: string;
  majorSubsystems: string[];
  keyPatterns: string[];
} {
  return {
    purpose: "",
    summary: "",
    keywords: [],
    architecture: "",
    dataFlow: "",
    majorSubsystems: [],
    keyPatterns: [],
  };
}

async function readRepoSummary(metaPaths: MetaPaths): Promise<RepoSummary | null> {
  try {
    const raw = await readFile(metaPaths.repoSummaryJson, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const envelope = parsed as RepoSummaryEnvelope;
    return envelope.repoSummary ?? null;
  } catch {
    return null;
  }
}
