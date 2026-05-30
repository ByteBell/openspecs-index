/**
 * Stage 1 prompt: the cheap "skim" pass. One window of a large file is summarised into a thin
 * structural outline (declarations + imports + one-line region summary), never a deep analysis.
 */
import { SKIM_JSON_SHAPE } from "./aware-fields.ts";

export const SKIM_SYSTEM_PROMPT = `You are skimming ONE WINDOW of a larger source file to build a thin structural outline.
List only the top-level declarations visible in this window, the imports it uses, and a
one-line summary of the region. Do NOT analyze bodies in depth — this is an index pass.
Copy each declaration's first line VERBATIM into "signature" so it can be located later.

${SKIM_JSON_SHAPE}`;

/**
 * Builds the user prompt for one skim window.
 *
 * @param input - The window's file path, position (index/total + line range) and raw content.
 * @returns The user-message string sent to `askJsonLLM` alongside `SKIM_SYSTEM_PROMPT`.
 */
export function buildSkimUserPrompt(input: {
  relativePath: string;
  windowIndex: number;
  totalWindows: number;
  startLine: number;
  endLine: number;
  content: string;
}): string {
  return `FILE_PATH: ${input.relativePath}
WINDOW: ${input.windowIndex + 1} of ${input.totalWindows} (lines ${input.startLine}-${input.endLine})
WINDOW_CONTENT:
${input.content}`;
}
