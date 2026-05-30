/**
 * Builds the FILE_MAP digest injected into every AWARE_CHUNK call — entirely in code, no LLM. The
 * digest gives a chunk the context of the whole file: a one-line overview per skimmed region plus
 * the ordered declaration index, each declaration tagged with the chunk (line range) it lives in,
 * so a chunk can resolve calls / imports defined elsewhere in the file.
 */
import type { FileChunk } from "#src/types/big-file.ts";
import type { LocatedDeclaration, SkimWindowOutline } from "#src/strategies/intermediate-representation/types.ts";

/** The chunk (line range) that contains `line`, or `null` when no chunk does. */
function chunkOf(chunks: FileChunk[], line: number): FileChunk | null {
  return chunks.find((c) => line >= c.startLine && line <= c.endLine) ?? null;
}

/**
 * Renders the file-map digest from the skim outlines, the located declarations, and the analysis
 * chunks they were cut into.
 *
 * @param outlines - The per-window skim outlines (their one-line summaries form the file overview).
 * @param located - The ordered declaration cut points.
 * @param chunks - The analysis chunks (used to tag each declaration with its chunk's line range).
 * @returns The digest string passed to `buildAwareChunkUserPrompt`.
 */
export function renderFileMapDigest(
  outlines: SkimWindowOutline[],
  located: LocatedDeclaration[],
  chunks: FileChunk[],
): string {
  const overview = outlines
    .map((o) => o.windowSummary.trim())
    .filter((s) => s.length > 0)
    .map((s, i) => `- region ${i + 1}: ${s}`)
    .join("\n");

  const declIndex = located
    .map((d) => {
      const chunk = chunkOf(chunks, d.startLine);
      const where = chunk === null ? "chunk ?" : `chunk lines ${chunk.startLine}-${chunk.endLine}`;
      return `- ${d.kind} ${d.name} [line ${d.startLine}] → ${where}`;
    })
    .join("\n");

  return `FILE OVERVIEW (one line per region):
${overview.length > 0 ? overview : "(none)"}

DECLARATIONS (every top-level declaration and the chunk it lives in):
${declIndex.length > 0 ? declIndex : "(none detected)"}`;
}
