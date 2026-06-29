import type { GithubIndexPayload, RepoLocation, UsageGuard } from "@bb/types";
import type { AskLlmOptions } from "@bb/llm";
import type { MetaPaths } from "./meta-paths.ts";
import type { ArchiveSink, SourceReader } from "./pipeline.ts";
import type { EffectiveIgnoreSets } from "#src/pipeline/skip-decisions/effective.ts";

export interface StrategyContext {
  knowledgeId: string;
  orgId: string;
  repoId: string;
  /** GitHub owner (e.g. "Dead-Bytes") — same value the clone path used. */
  owner: string;
  /** Bare repo name (e.g. "testing") — same value the clone path used. */
  repo: string;
  /** Resolved commit hash the clone is checked out to. */
  commitHash: string;
  /**
   * The full repo location (provider + ids + commit). Set by the driver. Lets a strategy that fans
   * work out to standalone workers (the IR queue-per-process path) hand them a `RepoLocation` to
   * rebuild `MetaPaths`. Absent in OSS standalone — the monolith path never needs it.
   */
  location?: RepoLocation;
  /**
   * Per-job LLM credential overrides extracted from the job payload. When
   * present, phases pass these to every `askLLM` / `askJsonLLM` call so the
   * per-org credential reaches the LLM provider. Absent in OSS standalone
   * runs, where calls fall back to `Config.OpenrouterApiKey`.
   */
  llmCallContext?: AskLlmOptions;
  /**
   * Optional second LLM context for fine-grained (per-unit) analysis. When a strategy runs a
   * high-volume per-unit pass, it routes those calls through this
   * context instead of {@link llmCallContext} — letting a job point them at a cheaper model. Built
   * from the payload's `unitsLlmModel`; absent when unset, and the strategy falls back to
   * {@link llmCallContext}.
   */
  unitsLlmCallContext?: AskLlmOptions;
  /**
   * Per-job effective ignore sets (seed defaults overlaid with the org's
   * overrides). Threaded into scan + skip-decider. Absent in OSS standalone
   * runs, where the built-in seed defaults apply.
   */
  ignoreSets?: EffectiveIgnoreSets;
}

export interface StrategyInput {
  payload: GithubIndexPayload;
  branch: string;
  source: SourceReader;
  archiveSink?: ArchiveSink;
  metaPaths: MetaPaths;
  context: StrategyContext;
  /**
   * Optional usage guard. When provided, the strategy calls
   * `onPhaseComplete(phase, cumulative)` after every token-consuming phase
   * so a downstream subscription enforcer can abort the run by throwing.
   * OSS standalone leaves this undefined and the strategy behaves
   * identically to today.
   */
  usageGuard?: UsageGuard;
}

export interface StrategyResult {
  filesAnalyzed: number;
  /**
   * Items (files, chunks, units) whose analysis errored and left no record on disk. A non-zero
   * count means the run is partial: the on-disk cache is incomplete and a resume must retry the
   * gaps. Strategies that don't track per-item failures omit the field.
   */
  filesFailed?: number;
  foldersSummarised: number;
  repoSummarised: boolean;
  graphNodesWritten: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
  /** Subset of `tokenUsage` served from cache / resumed from disk (not billable). */
  cachedTokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface IngestStrategy {
  readonly name: string;
  execute(input: StrategyInput): Promise<StrategyResult>;
}
