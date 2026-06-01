/**
 * Types owned by the intermediate-representation strategy. These describe the artifacts the
 * IR path builds for a big file: a thin per-window skim outline, the located declarations used
 * to cut the analysis chunks, and the per-chunk record that is kept verbatim (never condensed).
 */
import type { FileAnalysis } from "@bb/mongo";
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/unit-analysis/types/code-unit.ts";

/**
 * One top-level declaration discovered during the skim pass. `signature` is the verbatim first
 * line of the declaration and is used to locate it in the source deterministically (no AST)
 * when computing chunk boundaries (see {@link LocatedDeclaration}).
 */
export interface OutlineDeclaration {
  kind: string;
  name: string;
  signature: string;
  role: string;
}

/**
 * The thin outline produced for a single skim window. Output is intentionally small so the
 * outlines of every window concatenated still fit one context window.
 */
export interface SkimWindowOutline {
  startLine: number;
  endLine: number;
  language: string;
  windowSummary: string;
  importsInternal: string[];
  importsExternal: string[];
  declarations: OutlineDeclaration[];
}

/**
 * A declaration whose start line has been resolved in the source by matching its verbatim skim
 * `signature`. The located declarations are the cut points for the analysis chunks — a chunk
 * boundary only ever falls on a declaration start — and feed the file-map digest.
 */
export interface LocatedDeclaration {
  kind: string;
  name: string;
  signature: string;
  role: string;
  /** 1-based line in the source where the declaration begins. */
  startLine: number;
}

/**
 * A single kept chunk record. Carries a per-chunk `fileId` (the chunks of one big file share
 * `relativePath` but each gets a distinct id), its line range, and the chunk's analysis. These
 * are persisted as-is — the IR strategy never condenses them into one file analysis.
 */
export interface IrChunkRecord {
  /** Per-chunk node id, `${fileNodeId}:L${startLine}-${endLine}`; distinct per chunk, shared `relativePath`. */
  fileId: string;
  relativePath: string;
  chunkIndex: number;
  totalChunks: number;
  startLine: number;
  endLine: number;
  language: string;
  analysis: FileAnalysis;
  tokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number } | undefined;
}

/**
 * Per-unit SOURCE record written by Phase 6 (`extract-unit-sources`, pure). One file per
 * discovered unit descriptor, stored under
 * `unitAnalysisDir/<encoded>/(chunk-N/)?<safeUnit>.source.json`. The `source` slice is taken
 * verbatim from the parent file-analysis record's descriptor — Phase 6 does not re-read the
 * original file, it just re-projects the descriptor onto its own file. `chunkNumber` is
 * non-null when the unit came from a big-file chunk (1-based, matching the `chunk-N` filename
 * of the chunk's file-analysis record).
 */
export interface IrUnitSourceRecord {
  relativePath: string;
  chunkNumber: number | null;
  fileId: string;
  language: string;
  unitId: string;
  unitKind: string;
  name: string;
  qualifiedName: string;
  parentUnitId: string | null;
  startLine: number;
  endLine: number;
  isBehavioral: boolean;
  source: string;
  sha256: string;
  sizeBytes: number;
  tokenCount: number;
  extractedAt: string;
}

/**
 * Per-unit ANALYSIS record written by Phase 7 (`analyse-units`, one LLM call per unit). Holds
 * the fully-fingerprinted {@link CodeUnit} produced from the matching {@link IrUnitSourceRecord}
 * by `extractUnit`, plus per-call accounting. Stored beside the source record under
 * `unitAnalysisDir/<encoded>/(chunk-N/)?<safeUnit>.analysis.json`.
 */
export interface IrUnitAnalysisRecord {
  relativePath: string;
  chunkNumber: number | null;
  fileId: string;
  unitId: string;
  qualifiedName: string;
  codeUnit: CodeUnit;
  attempts: number;
  tokenUsage: TokenUsage;
  model: string;
  analysedAt: string;
}
