/**
 * Result envelope for the file-analysis (SPLIT) LLM call. Carries the split payload and the
 * call's token usage so callers can meter cost per phase. Reconstruction's per-phase envelopes
 * live next door in `reconstruction/types/results.ts`.
 */
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { FileAnalysisResult } from "./module-ir.ts";

/** Result of the file-analysis call: the file split plus the call's token usage. */
export interface AnalyseFileResult {
  split: FileAnalysisResult;
  tokenUsage: TokenUsage;
  /** Model id the LLM client actually answered with (the surviving fallback, if any). Empty when no call succeeded. */
  model: string;
}
