/**
 * Stage 3 prompt for the IR big-file path:
 *  - AWARE_CHUNK: deep-analyze one chunk WITH the file-map digest injected, so the chunk is
 *    analysed in the context of the whole file (the fix for context-blind chunking). The digest
 *    is assembled in code from the skim outlines — there is no file-level merge LLM call.
 */
import { AWARE_ANALYSIS_RULES, AWARE_DEEP_JSON_SHAPE } from "./aware-fields.ts";

export const AWARE_CHUNK_SYSTEM_PROMPT = `You are a code analysis engine for a knowledge graph. You are given ONE CHUNK of a larger
source file AND a FILE MAP describing the whole file (a one-line overview per region and every
declaration with the chunk it lives in). Analyze THIS CHUNK in the context of the whole file:
resolve calls and imports against the map, and when an element starts before or continues after
this chunk, take its identity from the map and analyze only the part present here.

${AWARE_ANALYSIS_RULES}

${AWARE_DEEP_JSON_SHAPE}`;

/**
 * Builds the user prompt for a context-aware deep chunk analysis.
 *
 * @param input - The chunk's path, position, the rendered file-map digest, and chunk content.
 * @returns The user-message string sent alongside `AWARE_CHUNK_SYSTEM_PROMPT`.
 */
export function buildAwareChunkUserPrompt(input: {
  relativePath: string;
  chunkIndex: number;
  totalChunks: number;
  startLine: number;
  endLine: number;
  fileMapDigest: string;
  content: string;
}): string {
  return `FILE_PATH: ${input.relativePath}
CHUNK: ${input.chunkIndex + 1} of ${input.totalChunks} (lines ${input.startLine}-${input.endLine})

FILE_MAP:
${input.fileMapDigest}

CHUNK_CONTENT:
${input.content}`;
}
