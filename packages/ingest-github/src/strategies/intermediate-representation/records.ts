/**
 * On-disk record shapes the IR strategy persists between phases. Every record is JSON, addressed
 * through the existing `MetaPaths` so the IR strategy shares disk layout with flat-folder.
 *
 * One shape — {@link IrFileAnalysisRecord} — is used for BOTH small files and big-file chunks.
 * For a small file the record sits at `fileAnalysisDir/<encoded>.json`. For a big-file chunk the
 * record sits at `bigFileChunksDir/<encoded>/chunk-N.json`; chunks of one big file all share the
 * same `relativePath` (their parent file). The chunk number is encoded in the filename only —
 * the IR strategy does NOT roll chunks up into a per-file manifest.
 */
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { FileAnalysisResult } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type {
  LocatedDeclaration,
  SkimWindowOutline,
} from "#src/strategies/intermediate-representation/types.ts";

/**
 * The persisted file-analysis record. Used for small files AND for each chunk of a big file. For
 * a chunk, `relativePath` is the parent file's path (shared across all chunks of that file);
 * the chunk number is encoded only in the filename (`chunk-N.json`).
 */
export interface IrFileAnalysisRecord {
  relativePath: string;
  language: string;
  sha256: string;
  sizeBytes: number;
  tokenCount: number;
  analysedAt: string;
  analysis: FileAnalysisResult;
  tokenUsage: TokenUsage;
  /** Model id the LLM client actually answered with for THIS file/chunk (the surviving fallback, if any). Empty when no call succeeded (failure-fallback record). */
  model: string;
}

/**
 * Boundaries computed for one big file — written ONCE per file by the boundary phase and consumed
 * by the cut phase. The outlines + located declarations together fully determine the chunk cuts;
 * nothing else is required to reproduce them.
 */
export interface IrBigFileBoundaries {
  relativePath: string;
  language: string;
  sizeBytes: number;
  tokenCount: number;
  generatedAt: string;
  skimOutlines: SkimWindowOutline[];
  locatedDeclarations: LocatedDeclaration[];
  skimTokenUsage: TokenUsage;
}

/**
 * One raw chunk of a big file produced by the cut phase BEFORE its file-analysis call. Carries
 * the verbatim chunk content so the analysis phase can run without re-reading the source file,
 * plus the chunk's line range and token count (used only for diagnostics; not persisted onto the
 * analysed record).
 */
export interface IrBigFileChunkRaw {
  relativePath: string;
  chunkIndex: number;
  totalChunks: number;
  startLine: number;
  endLine: number;
  tokenCount: number;
  content: string;
}
