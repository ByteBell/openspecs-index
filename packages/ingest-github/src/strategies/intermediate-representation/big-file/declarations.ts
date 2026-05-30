/**
 * Stage 2 of the IR big-file path (pure, no LLM). Two steps:
 *
 *  - `locateDeclarations` — resolve each skim declaration's start line by matching its VERBATIM
 *    `signature` against the source, bounded to the window it was skimmed from so duplicate
 *    signatures map to the right occurrence. The result is the ordered set of cut points.
 *  - `chunkByDeclarations` — cut the file into analysis chunks at those declaration starts,
 *    grouping whole declarations under the token budget so NO declaration is ever split across a
 *    chunk. Falls back to a plain token-budget split when no declaration could be located.
 */
import { tokenLen } from "@bb/llm";
import type { FileChunk } from "#src/types/big-file.ts";
import type { LocatedDeclaration, SkimWindowOutline } from "#src/strategies/intermediate-representation/types.ts";
import { splitByTokenBudget } from "#src/strategies/intermediate-representation/chunking.ts";

/** Finds the 1-based line of `signature` within `[fromLine, toLine]`; exact trimmed match, then substring. */
function findSignatureLine(lines: string[], signature: string, fromLine: number, toLine: number): number | null {
  const lo = Math.max(1, fromLine);
  const hi = Math.min(lines.length, toLine);
  for (let i = lo; i <= hi; i += 1) {
    if ((lines[i - 1] ?? "").trim() === signature) {
      return i;
    }
  }
  for (let i = lo; i <= hi; i += 1) {
    if ((lines[i - 1] ?? "").includes(signature)) {
      return i;
    }
  }
  return null;
}

/**
 * Resolves the start line of every skim declaration by matching its verbatim signature in the
 * source, then returns them de-duplicated by start line and sorted ascending.
 *
 * @param content - The full file source.
 * @param outlines - The per-window skim outlines (window order is preserved during the search).
 * @returns The ordered, de-duplicated located declarations (possibly empty).
 */
export function locateDeclarations(content: string, outlines: SkimWindowOutline[]): LocatedDeclaration[] {
  const lines = content.split("\n");
  const located: LocatedDeclaration[] = [];
  for (const outline of outlines) {
    let cursor = outline.startLine;
    for (const decl of outline.declarations) {
      const signature = decl.signature.trim();
      if (signature.length === 0) {
        continue;
      }
      const startLine = findSignatureLine(lines, signature, cursor, outline.endLine);
      if (startLine === null) {
        continue;
      }
      located.push({ kind: decl.kind, name: decl.name, signature: decl.signature, role: decl.role, startLine });
      cursor = startLine + 1;
    }
  }
  located.sort((a, b) => a.startLine - b.startLine);
  const seen = new Set<number>();
  const unique: LocatedDeclaration[] = [];
  for (const decl of located) {
    if (seen.has(decl.startLine)) {
      continue;
    }
    seen.add(decl.startLine);
    unique.push(decl);
  }
  return unique;
}

/** Assembles one {@link FileChunk} from a line span (`totalChunks` left at 0 for the caller to finalise). */
function makeChunk(relativePath: string, index: number, lines: string[], startLine: number, endLine: number): FileChunk {
  const content = lines.slice(startLine - 1, endLine).join("\n");
  return {
    relativePath,
    chunkIndex: index,
    totalChunks: 0,
    startLine,
    endLine,
    tokenCount: tokenLen(`${content}\n`),
    content,
  };
}

/**
 * Cuts the file into analysis chunks at declaration boundaries, grouping consecutive whole
 * declarations until the token budget would be exceeded. The first chunk begins at line 1 so any
 * header / imports preceding the first declaration are kept. Declarations are never split.
 *
 * @param relativePath - The file path stamped onto each chunk.
 * @param content - The full file source.
 * @param located - The ordered declaration cut points from {@link locateDeclarations}.
 * @param maxTokensPerChunk - The soft per-chunk token ceiling.
 * @returns The ordered chunks (`totalChunks` set on each); a token-budget split when `located` is empty.
 */
export function chunkByDeclarations(
  relativePath: string,
  content: string,
  located: LocatedDeclaration[],
  maxTokensPerChunk: number,
): FileChunk[] {
  if (located.length === 0) {
    return splitByTokenBudget(relativePath, content, maxTokensPerChunk);
  }
  const lines = content.split("\n");
  const lastLine = lines.length;
  const starts = located.map((d) => d.startLine);

  const chunks: FileChunk[] = [];
  let chunkStart = 1; // first chunk captures any preamble before the first declaration
  let chunkEnd = 0;
  let chunkTokens = 0;

  for (let i = 0; i < starts.length; i += 1) {
    const segStart = i === 0 ? 1 : (starts[i] ?? lastLine);
    const segEnd = i + 1 < starts.length ? (starts[i + 1] ?? lastLine) - 1 : lastLine;
    if (segEnd < segStart) {
      continue;
    }
    const segTokens = tokenLen(`${lines.slice(segStart - 1, segEnd).join("\n")}\n`);
    if (chunkTokens > 0 && chunkTokens + segTokens > maxTokensPerChunk) {
      chunks.push(makeChunk(relativePath, chunks.length, lines, chunkStart, chunkEnd));
      chunkStart = segStart;
      chunkTokens = segTokens;
    } else {
      chunkTokens += segTokens;
    }
    chunkEnd = segEnd;
  }
  if (chunkEnd >= chunkStart) {
    chunks.push(makeChunk(relativePath, chunks.length, lines, chunkStart, chunkEnd));
  }
  return chunks.map((c, _i, arr) => ({ ...c, totalChunks: arr.length }));
}
