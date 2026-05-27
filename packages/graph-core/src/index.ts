import { KnowledgeState } from "@bb/types";
import type {
  KnowledgeDoc,
  NodeScope,
  RepoSummaryPayload,
  UpsertRepoNodeInput,
  FolderSummaryPayload,
  UpsertFolderNodeInput,
  SnapshotFilesInput,
  UpsertFileNodeInput,
  GraphPingResult,
  UpsertConceptInput,
  AttachFileToConceptInput,
  UpsertContractInput,
  AttachFileToContractInput,
  UpsertGuidepostInput,
  AttachGuidepostInput,
  UpsertTestsEdgeInput,
} from "@bb/types";

export type {
  NodeScope,
  RepoSummaryPayload,
  UpsertRepoNodeInput,
  FolderSummaryPayload,
  UpsertFolderNodeInput,
  SnapshotFilesInput,
  UpsertFileNodeInput,
  GraphPingResult,
  UpsertConceptInput,
  AttachFileToConceptInput,
  UpsertContractInput,
  AttachFileToContractInput,
  UpsertGuidepostInput,
  AttachGuidepostInput,
  UpsertTestsEdgeInput,
};

export interface IGraphKnowledgeRepository {
  upsertKnowledgeNode(doc: KnowledgeDoc): Promise<void>;
  setKnowledgeStateInGraph(knowledgeId: string, state: KnowledgeState): Promise<void>;
  setKnowledgeBranchInGraph(knowledgeId: string, branch: string): Promise<void>;
  deleteKnowledgeGraph(knowledgeId: string): Promise<void>;
}

export interface IGraphFileRepository {
  upsertFileNode(input: UpsertFileNodeInput): Promise<void>;
  deleteFileNodes(knowledgeId: string, paths: string[]): Promise<void>;
  snapshotFilesToVersion(input: SnapshotFilesInput): Promise<void>;
  upsertFileNodesBatch?(inputs: readonly UpsertFileNodeInput[]): Promise<void>;
  bulkUpsertFiles?(knowledgeId: string, fileStream: AsyncIterable<UpsertFileNodeInput>): Promise<void>;
}

export interface IGraphFolderRepository {
  upsertFolderNode(input: UpsertFolderNodeInput): Promise<void>;
  upsertFolderNodesBatch?(inputs: readonly UpsertFolderNodeInput[]): Promise<void>;
}

export interface IGraphRepoRepository {
  upsertRepoNode(input: UpsertRepoNodeInput): Promise<void>;
}

export interface IGraphIndexRepository {
  ensureKnowledgeIndexes(): Promise<void>;
  ensureFlatFolderIndexes(): Promise<void>;
  ensureConceptGraphIndexes(): Promise<void>;
}

/**
 * Concept-graph hypergraph writes — `:Concept` nodes plus the file-to-concept
 * edges (`HAS_CONCEPT` / `PLAYS_ROLE` / `BELONGS_TO_DOMAIN`) and the file-to-
 * file `:TESTS` edge. All canonical keys are scoped by `(orgId, knowledgeId)`.
 */
export interface IGraphConceptRepository {
  upsertConcept(input: UpsertConceptInput): Promise<void>;
  attachFileToConcept(input: AttachFileToConceptInput): Promise<void>;
  upsertTestsEdge(input: UpsertTestsEdgeInput): Promise<void>;
}

/** `:Contract` nodes + `DEFINES` / `CONSUMES` edges. */
export interface IGraphContractRepository {
  upsertContract(input: UpsertContractInput): Promise<void>;
  attachFileToContract(input: AttachFileToContractInput): Promise<void>;
}

/** `:Guidepost` nodes + polymorphic `ABOUT` edges. */
export interface IGraphGuidepostRepository {
  upsertGuidepost(input: UpsertGuidepostInput): Promise<void>;
  attachGuidepost(input: AttachGuidepostInput): Promise<void>;
}

export interface IGraphDatabaseProvider {
  knowledge: IGraphKnowledgeRepository;
  files: IGraphFileRepository;
  folders: IGraphFolderRepository;
  repo: IGraphRepoRepository;
  indexes: IGraphIndexRepository;
  concepts: IGraphConceptRepository;
  contracts: IGraphContractRepository;
  guideposts: IGraphGuidepostRepository;

  connect(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<GraphPingResult>;
  runCypher(query: string, params?: Record<string, unknown>): Promise<unknown>;
  toNeo4jInt?(value: number): unknown;
}
