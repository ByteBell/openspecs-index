/**
 * Token-budget line splitter, local to the IR strategy so it does not depend on flat-folder.
 * Used both to cut the file into large skim windows and as the fallback / oversized-segment
 * splitter when computing semantic boundaries.
 */
import { tokenLen } from "@bb/llm";
import { logger } from "@bb/logger";
import type { FileChunk } from "#src/types/big-file.ts";

/**
 * Splits file content into contiguous chunks whose token count stays at or below
 * `maxTokensPerChunk`, breaking only at line boundaries. A single line longer than the budget
 * becomes its own (over-budget) chunk rather than being split mid-line.
 *
 * @param relativePath - The file path stamped onto each produced chunk.
 * @param content - The full file (or segment) content.
 * @param maxTokensPerChunk - The soft per-chunk token ceiling.
 * @param baseLine - 1-based line offset added to every chunk's line numbers (default 1). Used
 *                   when splitting a sub-segment so the returned lines map back to the file.
 * @returns The ordered chunks; `totalChunks` is set on each to the final count.
 */
export function splitByTokenBudget(
  relativePath: string,
  content: string,
  maxTokensPerChunk: number,
  baseLine = 1,
): FileChunk[] {
  const lines = content.split("\n");
  // WHY a file reaches here at all: it was routed to the big-file path because its token count
  // exceeded the context-window limit — it cannot be analyzed in one LLM call, so it must be cut
  // into pieces. This function does the cut on a pure TOKEN BUDGET, breaking only between lines.
  logger.debug(
    `splitByTokenBudget: ${relativePath} — cutting ${lines.length} lines (from line ${baseLine}) into ` +
      `windows of ≤${maxTokensPerChunk} tokens; cuts fall only on line boundaries`,
  );
  const chunks: FileChunk[] = [];
  let buf: string[] = [];
  let bufStartLine = baseLine;
  let bufTokens = 0;
  let currentLine = baseLine - 1;

  for (const line of lines) {
    currentLine += 1;
    const lineTokens = tokenLen(`${line}\n`);
    // Flush when adding this line would push the current buffer past the budget. The line that
    // triggered the flush starts the NEXT chunk — it is never the reason a chunk goes over budget.
    if (bufTokens + lineTokens > maxTokensPerChunk && buf.length > 0) {
      logger.debug(
        `splitByTokenBudget: ${relativePath} — flushing chunk #${chunks.length} ` +
          `(lines ${bufStartLine}-${currentLine - 1}, ${bufTokens} tokens): adding line ${currentLine} ` +
          `(${lineTokens} tokens) would exceed the ${maxTokensPerChunk}-token budget`,
      );
      chunks.push(makeChunk(relativePath, chunks.length, buf, bufStartLine, currentLine - 1, bufTokens));
      buf = [];
      bufStartLine = currentLine;
      bufTokens = 0;
    }
    // A single line bigger than the whole budget cannot be split mid-line, so it becomes its own
    // over-budget chunk. This is the one case where a chunk legitimately exceeds maxTokensPerChunk.
    if (lineTokens > maxTokensPerChunk) {
      logger.debug(
        `splitByTokenBudget: ${relativePath} — line ${currentLine} is ${lineTokens} tokens by itself ` +
          `(> ${maxTokensPerChunk} budget); kept whole as an over-budget chunk (never split mid-line)`,
      );
    }
    buf.push(line);
    bufTokens += lineTokens;
  }
  if (buf.length > 0) {
    logger.debug(
      `splitByTokenBudget: ${relativePath} — flushing final chunk #${chunks.length} ` +
        `(lines ${bufStartLine}-${currentLine}, ${bufTokens} tokens)`,
    );
    chunks.push(makeChunk(relativePath, chunks.length, buf, bufStartLine, currentLine, bufTokens));
  }
  logger.debug(`splitByTokenBudget: ${relativePath} — produced ${chunks.length} chunk(s) total`);
  return chunks.map((c, _i, arr) => ({ ...c, totalChunks: arr.length }));
}

/**
 * Constructs one {@link FileChunk} from a buffer of lines and its bookkeeping.
 *
 * @param relativePath - The file path stamped onto the chunk.
 * @param index - The 0-based chunk index.
 * @param buf - The lines belonging to this chunk.
 * @param startLine - 1-based first line of the chunk.
 * @param endLine - 1-based last line of the chunk.
 * @param tokenCount - The chunk's token count.
 * @returns The assembled chunk (with `totalChunks` left at 0 for the caller to finalise).
 */
function makeChunk(
  relativePath: string,
  index: number,
  buf: string[],
  startLine: number,
  endLine: number,
  tokenCount: number,
): FileChunk {
  return {
    relativePath,
    chunkIndex: index,
    totalChunks: 0,
    startLine,
    endLine,
    tokenCount,
    content: buf.join("\n"),
  };
}
