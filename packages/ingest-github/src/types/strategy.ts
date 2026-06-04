import type { GithubIndexPayload, UsageGuard } from "@bb/types";
import type { AskLlmOptions } from "@bb/llm";
import type { MetaPaths } from "./meta-paths.ts";
import type { ArchiveSink, SourceReader } from "./pipeline.ts";

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
   * Per-job LLM credential overrides extracted from the job payload. When
   * present, phases pass these to every `askLLM` / `askJsonLLM` call so the
   * per-org credential reaches the LLM provider. Absent in OSS standalone
   * runs, where calls fall back to `Config.OpenrouterApiKey`.
   */
  llmCallContext?: AskLlmOptions;
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
  foldersSummarised: number;
  repoSummarised: boolean;
  graphNodesWritten: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface IngestStrategy {
  readonly name: string;
  execute(input: StrategyInput): Promise<StrategyResult>;
}
