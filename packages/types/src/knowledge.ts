export enum KnowledgeState {
  Created = "CREATED",
  Queued = "QUEUED",
  Ingested = "INGESTED",
  Processing = "PROCESSING",
  Processed = "PROCESSED",
  Failed = "FAILED",
}

export interface CommitHashRecord {
  hash: string;
  inputTokens: string;
  outputTokens: string;
  /** Authoritative provider-reported cost in USD (OpenRouter `usage.cost`). "0" for Ollama or when omitted by provider. */
  costUsd: string;
}

export interface GithubKnowledgeSource {
  kind: "github";
  /** Current head pointer — the most recently indexed commit. */
  commitId?: string;
  /** Every commit this knowledge has been indexed at, oldest → newest. Pull appends to this list. */
  commitHashes?: (string | CommitHashRecord)[];
}

export interface LocalKnowledgeSource {
  kind: "local";
  sourcePath: string;
}

export type KnowledgeSource = GithubKnowledgeSource | LocalKnowledgeSource;

export interface KnowledgeInfo {
  repoUrl?: string;
  branch?: string;
  git_url?: string;
  githubInfo?: { commitId?: string; commitHashes?: string[]; branchName?: string };
  [key: string]: unknown;
}

/**
 * Categorises why a knowledge ingestion failed. Drives operator triage and
 * downstream UI hints.
 *
 * - `llm_config` — missing or empty API key (operator action required)
 * - `llm_auth` — 401/403 from provider, key invalid/expired (operator action)
 * - `llm_quota` — 402, credit/billing exhausted (operator action)
 * - `llm_rate_limit` — 429, transient — could be retried later by operator
 * - `llm_unreachable` — 5xx / network / timeout (transient infra issue)
 * - `cancelled` — operator-initiated cancellation
 * - `usage_limit_exceeded` — downstream subscription quota tripped mid-run; partial usage was charged
 * - `internal` — anything else (bug, infra, unexpected exception)
 */
export type KnowledgeFailureCategory =
  | "llm_config"
  | "llm_auth"
  | "llm_quota"
  | "llm_rate_limit"
  | "llm_unreachable"
  | "cancelled"
  | "usage_limit_exceeded"
  | "internal";

/**
 * Cumulative token totals consumed by an ingestion run. Mirrors the shape
 * returned by the per-phase analyzers (`StrategyResult.tokenUsage`) — the
 * three fields are identical so a guard implementation can compare or
 * persist them without further reshaping.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Optional callback contract for enforcing downstream usage limits during a
 * pipeline run. OSS itself never constructs an instance — the enterprise
 * wrapper supplies one when wiring `runner.run(...)` / `runPull(...)`.
 *
 * The pipeline calls `onPhaseComplete` after every token-consuming phase
 * with the cumulative tokens consumed by *this* job so far. If the guard
 * decides the user is over budget it throws a typed error (OSS catches it
 * by class, not by category), at which point the pipeline calls
 * `flushPartial` with the same cumulative figure so the partial usage is
 * persisted before the failure surfaces.
 */
export interface UsageGuard {
  onPhaseComplete(phase: string, cumulative: TokenUsage): Promise<void>;
  flushPartial(cumulative: TokenUsage): Promise<void>;
}

export interface KnowledgeFailure {
  /** Short, operator-readable sentence. UI can render this directly. */
  reason: string;
  category: KnowledgeFailureCategory;
  at: Date;
  /** Raw provider response or structured detail for debugging. May be long. */
  detail?: string;
}

/**
 * State machine for the ConceptGraphStrategy enrichment phase. Independent
 * of `KnowledgeState` — a knowledge stays in `PROCESSING` until enrichment
 * reaches `Completed`, then transitions to `PROCESSED`.
 */
export enum EnrichmentState {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}

export type EnrichmentFailureReason = "cap-exceeded" | "validation-failed" | "provider-error";

export interface EnrichmentFailure {
  filePath: string;
  reason: EnrichmentFailureReason;
  attemptCount: number;
  lastError: string;
  lastAttemptAt: Date;
}

export interface KnowledgeDoc {
  knowledgeId: string;
  source: KnowledgeSource;
  status: {
    state: KnowledgeState;
    totalFiles?: number;
    processedFiles?: number;
    /** Phase-weighted overall progress (0–100). Set by the ingestion progress reporter. */
    progressPercent?: number;
    /** Name of the phase currently executing (e.g. "file_analysis", "indexing"). */
    currentPhase?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  info: KnowledgeInfo;
  /**
   * Populated when `status.state === KnowledgeState.Failed`. Cleared
   * automatically on the next successful transition out of FAILED.
   */
  failure?: KnowledgeFailure;
  /**
   * Set when this knowledge is being / has been processed by
   * ConceptGraphStrategy. Absent for legacy flat-folder knowledges. The
   * worker writes a fresh UUID at the start of each enrichment attempt
   * and threads it through every `:Concept` / `:Contract` / `:Guidepost`
   * + edge it upserts so a single run is queryable end-to-end.
   */
  enrichmentRunId?: string;
  enrichmentState?: EnrichmentState;
  /** Relative paths of files that have completed enrichment in this run. */
  completedFiles?: string[];
  /** Per-file failure diagnostics. Cleared on a fresh enrichment run. */
  enrichmentFailures?: EnrichmentFailure[];
}

export interface KnowledgeListEntry extends KnowledgeDoc {
  fileCount: number;
}
