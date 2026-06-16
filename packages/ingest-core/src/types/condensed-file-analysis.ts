import type { FileAnalysis } from "@bb/db-core";

export interface CondensedFileAnalysis {
  relativePath: string;
  language: string;
  sha256: string;
  sizeBytes: number;
  tokenCount: number;
  isBigFile: boolean;
  totalChunks: number;
  totalTokenCount: number;
  analysedAt: string;
  analysis: FileAnalysis;
  tokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number } | undefined;
  /**
   * Subset of `tokenUsage` that was served from the `@bb/llm` disk cache (no
   * fresh provider spend) when this file was produced. Persisted but only read
   * back for display — on resume the whole file counts as cached for the run.
   */
  cachedTokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number } | undefined;
}
