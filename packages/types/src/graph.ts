import type { FileAnalysis } from "./analysis.ts";

export interface NodeScope {
  orgId: string;
  knowledgeId: string;
  repoId: string;
}

export interface RepoSummaryPayload {
  purpose: string;
  summary: string;
  keywords: string[];
  architecture: string;
  dataFlow: string;
  majorSubsystems: string[];
  keyPatterns: string[];
}

export interface UpsertRepoNodeInput {
  scope: NodeScope;
  repoUrl: string;
  branch: string;
  /** GitHub owner — persisted to RepoSummary.user_name (matches the on-disk clone path segment). */
  owner: string;
  /** Bare repo name — persisted to RepoSummary.repo_name (matches the on-disk clone path segment). */
  repo: string;
  /** Resolved commit hash — persisted to RepoSummary.commit_hash and Knowledge.commit_hash. */
  commitHash: string;
  summary: RepoSummaryPayload;
}

export interface FolderSummaryPayload {
  purpose: string;
  summary: string;
  keywords: string[];
  classes: string[];
  functions: string[];
  importsInternal: string[];
  importsExternal: string[];
  dependencyGraph: string;
}

export interface UpsertFolderNodeInput {
  scope: NodeScope;
  folderPath: string;
  summary: FolderSummaryPayload;
}

export interface SnapshotFilesInput {
  knowledgeId: string;
  commitHash: string;
}

export interface UpsertFileNodeInput {
  orgId?: string;
  knowledgeId: string;
  repoId?: string;
  relativePath: string;
  language: string;
  sha: string;
  sizeBytes: number;
  analysis: FileAnalysis;
  folderPath?: string;
  isBigFile?: boolean;
  totalChunks?: number;
  totalTokenCount?: number;
}

export interface GraphPingResult {
  ok: boolean;
  latencyMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concept-graph / hypergraph enrichment (ConceptGraphStrategy)
// ─────────────────────────────────────────────────────────────────────────────

export enum ConceptKind {
  Ontology = "ontology",
  Business = "business",
  Capability = "capability",
  Role = "role",
  Pattern = "pattern",
  Domain = "domain",
}

export enum ContractKind {
  Interface = "interface",
  Schema = "schema",
  Event = "event",
  Config = "config",
}

export enum GuidepostKind {
  Anomaly = "anomaly",
  Convention = "convention",
  History = "history",
  Warning = "warning",
  StartingPoint = "starting-point",
}

/** Which edge attaches a `:File` to a `:Concept`. */
export type ConceptEdgeKind = "HAS_CONCEPT" | "PLAYS_ROLE" | "BELONGS_TO_DOMAIN";

/** Which edge attaches a `:File` to a `:Contract`. */
export type ContractEdgeKind = "DEFINES" | "CONSUMES";

/**
 * Concept canonical key is `(orgId, knowledgeId, slug)`. `rationale` is
 * first-write-wins (preserved on subsequent upserts). The set of attaching
 * files is derived from `HAS_CONCEPT` / `PLAYS_ROLE` / `BELONGS_TO_DOMAIN`
 * edges — never stored as a list on the node.
 */
export interface UpsertConceptInput {
  scope: NodeScope;
  slug: string;
  kind: ConceptKind;
  name: string;
  rationale: string;
  enrichmentRunId: string;
}

export interface AttachFileToConceptInput {
  scope: NodeScope;
  relativePath: string;
  conceptSlug: string;
  edgeKind: ConceptEdgeKind;
  enrichmentRunId: string;
}

export interface UpsertContractInput {
  scope: NodeScope;
  slug: string;
  kind: ContractKind;
  name: string;
  enrichmentRunId: string;
}

export interface AttachFileToContractInput {
  scope: NodeScope;
  relativePath: string;
  contractSlug: string;
  edgeKind: ContractEdgeKind;
  enrichmentRunId: string;
}

/**
 * A `:Guidepost` is an LLM-authored observation. `area` is a free-text scope
 * descriptor (e.g. "auth", "ingestion pipeline"); we keep it as a string
 * property rather than promoting it to a node so guideposts stay narrative,
 * not relational.
 */
export interface UpsertGuidepostInput {
  scope: NodeScope;
  slug: string;
  kind: GuidepostKind;
  note: string;
  area: string;
  enrichmentRunId: string;
}

/**
 * Polymorphic ABOUT edge. Exactly one of `targetFileRelativePath`,
 * `targetConceptSlug`, `targetContractSlug` must be set; consumers throw on
 * ambiguous input rather than silently choosing.
 */
export interface AttachGuidepostInput {
  scope: NodeScope;
  guidepostSlug: string;
  targetFileRelativePath?: string;
  targetConceptSlug?: string;
  targetContractSlug?: string;
  enrichmentRunId: string;
}

/** File-to-file `:TESTS` edge — the test source file points at the file under test. */
export interface UpsertTestsEdgeInput {
  scope: NodeScope;
  testFileRelativePath: string;
  targetFileRelativePath: string;
  enrichmentRunId: string;
}
