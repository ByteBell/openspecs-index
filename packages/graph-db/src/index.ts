import type {
  IGraphDatabaseProvider,
  IGraphKnowledgeRepository,
  IGraphFileRepository,
  IGraphFolderRepository,
  IGraphRepoRepository,
  IGraphIndexRepository,
  IGraphConceptRepository,
  IGraphContractRepository,
  IGraphGuidepostRepository,
  GraphPingResult,
} from "@bb/graph-core";

let activeProvider: IGraphDatabaseProvider | null = null;
const providers = new Map<string, () => IGraphDatabaseProvider>();

export function registerGraphProvider(name: string, factory: () => IGraphDatabaseProvider) {
  providers.set(name, factory);
}

export function getGraph(): IGraphDatabaseProvider {
  if (!activeProvider) {
    throw new Error("Graph database provider not initialized. Call connectGraph() first.");
  }
  return activeProvider;
}

export async function connectGraph(providerName: string): Promise<void> {
  const factory = providers.get(providerName);
  if (!factory) {
    throw new Error(`Graph database provider '${providerName}' not registered.`);
  }
  activeProvider = factory();
  await activeProvider.connect();
}

export async function closeGraph(): Promise<void> {
  if (activeProvider) {
    await activeProvider.close();
    activeProvider = null;
  }
}

export const knowledgeGraph: IGraphKnowledgeRepository = {
  upsertKnowledgeNode: (...args) => getGraph().knowledge.upsertKnowledgeNode(...args),
  setKnowledgeStateInGraph: (...args) => getGraph().knowledge.setKnowledgeStateInGraph(...args),
  setKnowledgeBranchInGraph: (...args) => getGraph().knowledge.setKnowledgeBranchInGraph(...args),
  deleteKnowledgeGraph: (...args) => getGraph().knowledge.deleteKnowledgeGraph(...args),
};

export const filesGraph: IGraphFileRepository = {
  upsertFileNode: (...args) => getGraph().files.upsertFileNode(...args),
  deleteFileNodes: (...args) => getGraph().files.deleteFileNodes(...args),
  snapshotFilesToVersion: (...args) => getGraph().files.snapshotFilesToVersion(...args),
  upsertFileNodesBatch: async (inputs) => {
    const f = getGraph().files;
    if (f.upsertFileNodesBatch) {
      await f.upsertFileNodesBatch(inputs);
    } else {
      for (const input of inputs) {
        await f.upsertFileNode(input);
      }
    }
  },
  bulkUpsertFiles: async (knowledgeId, fileStream) => {
    const f = getGraph().files;
    if (f.bulkUpsertFiles) {
      return f.bulkUpsertFiles(knowledgeId, fileStream);
    }
    for await (const input of fileStream) {
      await f.upsertFileNode(input);
    }
  },
};

export const foldersGraph: IGraphFolderRepository = {
  upsertFolderNode: (...args) => getGraph().folders.upsertFolderNode(...args),
  upsertFolderNodesBatch: async (inputs) => {
    const f = getGraph().folders;
    if (f.upsertFolderNodesBatch) {
      await f.upsertFolderNodesBatch(inputs);
    } else {
      for (const input of inputs) {
        await f.upsertFolderNode(input);
      }
    }
  },
};

export const repoGraph: IGraphRepoRepository = {
  upsertRepoNode: (...args) => getGraph().repo.upsertRepoNode(...args),
};

export const indexesGraph: IGraphIndexRepository = {
  ensureKnowledgeIndexes: (...args) => getGraph().indexes.ensureKnowledgeIndexes(...args),
  ensureFlatFolderIndexes: (...args) => getGraph().indexes.ensureFlatFolderIndexes(...args),
  ensureConceptGraphIndexes: (...args) => getGraph().indexes.ensureConceptGraphIndexes(...args),
};

export const conceptsGraph: IGraphConceptRepository = {
  upsertConcept: (...args) => getGraph().concepts.upsertConcept(...args),
  attachFileToConcept: (...args) => getGraph().concepts.attachFileToConcept(...args),
  upsertTestsEdge: (...args) => getGraph().concepts.upsertTestsEdge(...args),
};

export const contractsGraph: IGraphContractRepository = {
  upsertContract: (...args) => getGraph().contracts.upsertContract(...args),
  attachFileToContract: (...args) => getGraph().contracts.attachFileToContract(...args),
};

export const guidepostsGraph: IGraphGuidepostRepository = {
  upsertGuidepost: (...args) => getGraph().guideposts.upsertGuidepost(...args),
  attachGuidepost: (...args) => getGraph().guideposts.attachGuidepost(...args),
};

export async function pingGraph(): Promise<GraphPingResult> {
  return getGraph().ping();
}

export async function runCypher(query: string, params?: Record<string, unknown>): Promise<unknown> {
  return getGraph().runCypher(query, params);
}

export function toNeo4jInt(value: number): unknown {
  const provider = getGraph();
  if (provider.toNeo4jInt) {
    return provider.toNeo4jInt(value);
  }
  return value;
}
