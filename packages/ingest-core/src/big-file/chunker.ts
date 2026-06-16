import { tokenLen } from "@bb/llm";
import type { FileChunk } from "#src/types/big-file.ts";

export function splitFileIntoChunks(relativePath: string, content: string, maxTokensPerChunk: number): FileChunk[] {
  const lines = content.split("\n");
  const chunks: FileChunk[] = [];
  let buf: string[] = [];
  let bufStartLine = 1;
  let bufTokens = 0;
  let currentLine = 0;

  for (const line of lines) {
    currentLine += 1;
    const lineTokens = tokenLen(`${line}\n`);
    if (bufTokens + lineTokens > maxTokensPerChunk && buf.length > 0) {
      chunks.push(makeChunk(relativePath, chunks.length, buf, bufStartLine, currentLine - 1, bufTokens));
      buf = [];
      bufStartLine = currentLine;
      bufTokens = 0;
    }
    buf.push(line);
    bufTokens += lineTokens;
  }
  if (buf.length > 0) {
    chunks.push(makeChunk(relativePath, chunks.length, buf, bufStartLine, currentLine, bufTokens));
  }
  return chunks.map((c, _i, arr) => ({ ...c, totalChunks: arr.length }));
}

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
