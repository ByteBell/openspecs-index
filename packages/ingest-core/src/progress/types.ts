/**
 * Progress-reporting extension port.
 *
 * `@bb/ingest-github` exposes this interface so a host binary can observe
 * phase progress without the strategy importing the host's transport. The
 * default is a no-op (`NullProgressContext`) — consistent with the
 * no-outbound-calls posture.
 */

export type ProgressPhase = "clone" | "scan" | "file_analysis" | "folder_analysis" | "indexing" | "enrichment";

export type ProgressTotalMode = { kind: "fixed"; total: number } | { kind: "growing"; initialTotal?: number };

export interface ProgressReporterInput {
  readonly phase: ProgressPhase;
  readonly subPhase?: string;
  readonly total: ProgressTotalMode;
  readonly resolveInitialProcessed?: () => Promise<number> | number;
}

/**
 * Per-phase progress sink. One instance per phase or sub-phase of a job.
 * The host implementation decides whether emissions are timer-sampled,
 * push-per-call, persisted, or discarded.
 */
export interface ProgressReporter {
  start(): Promise<void>;
  increment(delta?: number, meta?: { fileName?: string }): void;
  /** Grow the denominator when the work set is a streaming iterator. */
  incrementSeen(delta?: number): void;
  setTotal(total: number): void;
  stop(): void;
}

/**
 * Bundle of progress facilities scoped to a single ingestion job. Returned
 * by `ProgressContextFactory(knowledgeId)`.
 */
export interface ProgressContext {
  reporter(input: ProgressReporterInput): ProgressReporter;
  phaseChanged(phase: ProgressPhase): void;
  completed(message?: string): void;
  /**
   * Emit a terminal FAILED event. `error` is a short operator-readable
   * sentence (e.g. "OpenRouter is out of credits"). `category` is the
   * classification taxonomy (`"llm_config" | "llm_auth" | "llm_quota" |
   * "llm_rate_limit" | "llm_unreachable" | "cancelled" | "internal"`).
   * `detail` is the optional raw provider response or structured debug
   * payload — UIs typically hide it behind a disclosure.
   */
  failed(error: string, phase?: ProgressPhase, category?: string, detail?: string): void;
}

export type ProgressContextFactory = (knowledgeId: string) => ProgressContext;
