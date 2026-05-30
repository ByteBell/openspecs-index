/**
 * The IR big-file analyzer. Unlike flat-folder's `processBigFile` (which condenses every chunk's
 * analysis into one summary), this path keeps each chunk's analysis VERBATIM, and it owns its
 * chunk analysis end to end — it borrows NOTHING from flat-folder:
 *
 *   1) SKIM   — split the file into windows on a token budget (`splitByTokenBudget`) and skim each
 *               window into a thin outline (declarations + verbatim signatures + a region summary).
 *   2) LOCATE — resolve each declaration's start line in the source by matching its signature, then
 *               cut the file into analysis chunks at those declaration boundaries (no LLM, no split
 *               declaration). The skim outlines + located declarations are rendered into a file-map
 *               digest in code (no merge call).
 *   3) AWARE  — deep-analyze each chunk WITH the digest injected, so a chunk resolves symbols
 *               defined elsewhere in the file; emit one `IrChunkRecord` per chunk.
 *
 * The chunks of one file share `relativePath` but each gets a distinct `fileId`
 * (`${fileNodeId}:L${startLine}-${endLine}`). It NEVER condenses. The analyzer is pure — no disk
 * or graph writes; the caller persists the records.
 */
import { tokenLen, type AskLlmOptions } from "@bb/llm";
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { logger } from "@bb/logger";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { splitByTokenBudget } from "#src/strategies/intermediate-representation/chunking.ts";
import type {
  IrChunkRecord,
  LocatedDeclaration,
  SkimWindowOutline,
} from "#src/strategies/intermediate-representation/types.ts";
import type { FileChunk } from "#src/types/big-file.ts";
import { skimWindow } from "./skim.ts";
import { locateDeclarations, chunkByDeclarations } from "./declarations.ts";
import { renderFileMapDigest } from "./file-map.ts";
import { analyzeAwareChunk } from "./chunk-analyzer.ts";

/** Input to the IR big-file analysis. */
export interface AnalyzeBigFileInput {
  relativePath: string;
  language: string;
  content: string;
  /** Stable file-node id; each chunk derives its own `fileId` from this + its line range. */
  fileNodeId: string;
  llmCallContext?: AskLlmOptions;
}

/** The whole-file result: every chunk's verbatim analysis (never condensed) + summed usage. */
export interface IrBigFileResult {
  relativePath: string;
  language: string;
  totalChunks: number;
  chunks: IrChunkRecord[];
  tokenUsage: TokenUsage;
}

/** Boundary-aware chunks of a big file (skim + locate cuts) WITHOUT per-chunk deep analysis. */
export interface BigFileChunksResult {
  relativePath: string;
  language: string;
  chunks: FileChunk[];
  /** Cost of the SKIM phase used to find declaration boundaries. */
  tokenUsage: TokenUsage;
}

/** The public, callable interface for IR big-file chunk analysis. */
export interface IrBigFileAnalyzer {
  /** True when the file's token count exceeds `Config.ContextWindowLimit` (the big-file threshold). */
  isBigFile(content: string): boolean;
  /** Skim → locate declarations → cut chunks → aware-analyze each → persist-ready records (no condensation). */
  analyzeBigFile(input: AnalyzeBigFileInput): Promise<IrBigFileResult>;
  /** Skim → locate declarations → cut chunks at boundaries; returns the cuts WITHOUT deep-analyzing them. */
  chunkBigFile(input: AnalyzeBigFileInput): Promise<BigFileChunksResult>;
}

/**
 * Creates an {@link IrBigFileAnalyzer}. Stateless — reads the token budget / threshold from config
 * per call, so config changes take effect without re-creating the analyzer.
 *
 * @returns A ready-to-use big-file analyzer.
 */
/**
 * SKIM the file into window outlines, LOCATE each declaration's start line, then cut the file at
 * those boundaries (never splitting a declaration). Shared by `analyzeBigFile` (which then
 * deep-analyzes each chunk) and `chunkBigFile` (which returns the cuts as-is). The returned
 * `tokenUsage` is the SKIM cost.
 */
async function skimAndChunk(
  input: AnalyzeBigFileInput,
  maxTokensPerChunk: number,
): Promise<{
  outlines: SkimWindowOutline[];
  located: LocatedDeclaration[];
  chunks: FileChunk[];
  tokenUsage: TokenUsage;
}> {
  const windows = splitByTokenBudget(input.relativePath, input.content, maxTokensPerChunk);
  logger.debug(`big-file: ${input.relativePath} — SKIM produced ${windows.length} window(s)`);
  let usage = ZERO_USAGE;
  const outlines: SkimWindowOutline[] = [];
  for (const window of windows) {
    const skimmed = await skimWindow(window, windows.length, input.llmCallContext);
    usage = addUsage(usage, skimmed.tokenUsage);
    outlines.push(skimmed.outline);
  }
  const located = locateDeclarations(input.content, outlines);
  const chunks = chunkByDeclarations(input.relativePath, input.content, located, maxTokensPerChunk);
  return { outlines, located, chunks, tokenUsage: usage };
}

export function createIrBigFileAnalyzer(): IrBigFileAnalyzer {
  return {
    isBigFile(content: string): boolean {
      return tokenLen(content) > getConfigValue(Config.ContextWindowLimit);
    },

    async analyzeBigFile(input: AnalyzeBigFileInput): Promise<IrBigFileResult> {
      const maxTokensPerChunk = getConfigValue(Config.MaxTokensPerChunk);

      // This file is here because it is BIG (tokens > the context-window limit) and cannot be
      // analyzed in one call. SKIM cuts it into ≤maxTokensPerChunk windows; LOCATE re-cuts at real
      // declaration boundaries. Log the size→budget relation so the chunk count is explainable.
      logger.debug(
        `analyzeBigFile: ${input.relativePath} is big — ${tokenLen(input.content)} tokens > ` +
          `window ${getConfigValue(Config.ContextWindowLimit)}; SKIM-windowing at ≤${maxTokensPerChunk} tokens/window`,
      );

      // 1+2) SKIM + LOCATE — cut at real declaration boundaries, then build the file-map digest.
      const { outlines, located, chunks: analysisChunks, tokenUsage: skimUsage } = await skimAndChunk(
        input,
        maxTokensPerChunk,
      );
      let usage = skimUsage;
      const fileMapDigest = renderFileMapDigest(outlines, located, analysisChunks);

      // 3) AWARE — deep-analyze each chunk with the digest; derive a distinct fileId per chunk.
      const chunks: IrChunkRecord[] = [];
      for (const chunk of analysisChunks) {
        const result = await analyzeAwareChunk(chunk, fileMapDigest, input.llmCallContext);
        usage = addUsage(usage, result.tokenUsage ?? ZERO_USAGE);
        chunks.push({
          fileId: `${input.fileNodeId}:L${result.startLine}-${result.endLine}`,
          relativePath: result.relativePath,
          chunkIndex: result.chunkIndex,
          totalChunks: result.totalChunks,
          startLine: result.startLine,
          endLine: result.endLine,
          language: result.language,
          analysis: result.analysis,
          ...(result.tokenUsage !== undefined ? { tokenUsage: result.tokenUsage } : {}),
        });
      }

      return {
        relativePath: input.relativePath,
        language: input.language,
        totalChunks: chunks.length,
        chunks,
        tokenUsage: usage,
      };
    },

    async chunkBigFile(input: AnalyzeBigFileInput): Promise<BigFileChunksResult> {
      const maxTokensPerChunk = getConfigValue(Config.MaxTokensPerChunk);
      logger.debug(
        `chunkBigFile: ${input.relativePath} — boundary-aware chunking (skim + locate), no per-chunk analysis`,
      );
      const { chunks, tokenUsage } = await skimAndChunk(input, maxTokensPerChunk);
      return { relativePath: input.relativePath, language: input.language, chunks, tokenUsage };
    },
  };
}
