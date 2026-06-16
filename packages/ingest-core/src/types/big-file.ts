import type { FileAnalysis } from "@bb/db-core";

export type BigFileReason = "context-window-exceeded" | "too-large";

export interface BigFileEntry {
  relativePath: string;
  sizeBytes: number;
  tokenCount: number;
  reason: BigFileReason;
}

export interface FileChunk {
  relativePath: string;
  chunkIndex: number;
  totalChunks: number;
  startLine: number;
  endLine: number;
  tokenCount: number;
  content: string;
}

export interface ChunkAnalysisResult {
  relativePath: string;
  chunkIndex: number;
  totalChunks: number;
  startLine: number;
  endLine: number;
  language: string;
  analysis: FileAnalysis;
  tokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number } | undefined;
  /** Subset of `tokenUsage` served from the `@bb/llm` disk cache (no fresh spend). */
  cachedTokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number } | undefined;
}

export interface HugeFileManifest {
  relativePath: string;
  totalChunks: number;
  totalTokenCount: number;
  chunkPaths: string[];
  generatedAt: string;
}
