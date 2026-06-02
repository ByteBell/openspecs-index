import type { GithubIndexPayload } from "@bb/types";
import type { AskLlmOptions } from "@bb/llm";
import type { MetaPaths } from "./meta-paths.ts";
import type { ArchiveSink, SourceReader } from "./pipeline.ts";

export interface StrategyContext {
  knowledgeId: string;
  orgId: string;
  repoId: string;
  /**
   * Per-job LLM credential overrides extracted from the job payload. When
   * present, phases pass these to every `askLLM` / `askJsonLLM` call so the
   * per-org credential reaches the LLM provider. Absent in OSS standalone
   * runs, where calls fall back to `Config.OpenrouterApiKey`.
   */
  llmCallContext?: AskLlmOptions;
  /**
   * Optional override for the per-unit IR analysis call (phase 7 of the IR strategy). When
   * present, `analyseUnits` uses this instead of {@link llmCallContext}. Lets a driver route
   * file-analysis (phase 2/5) through one model and per-unit reconstruction through another —
   * e.g. claude for file-level + minimax for unit-level. Absent → unit calls fall back to
   * {@link llmCallContext}.
   */
  unitsLlmCallContext?: AskLlmOptions;
}

export interface StrategyInput {
  payload: GithubIndexPayload;
  branch: string;
  source: SourceReader;
  archiveSink?: ArchiveSink;
  metaPaths: MetaPaths;
  context: StrategyContext;
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
