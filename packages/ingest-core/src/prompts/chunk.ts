import { FILE_ANALYSIS_FIELDS_BLOCK } from "./file-analysis-fields.ts";

export const CHUNK_ANALYSIS_SYSTEM_PROMPT = `You are a precise code analyst. You produce JSON describing ONE chunk of a larger source file for a code knowledge graph.

Rules:
- Focus on what exists in THIS CHUNK only. Do not infer content from other chunks.
- Return ONLY a JSON object. No prose, no markdown fences, no commentary.
- Use EXACTLY the keys defined below. Omit no key; use an empty value when the field does not apply.
- Do not invent line ranges — derive them from the actual chunk content.

Field definitions:

${FILE_ANALYSIS_FIELDS_BLOCK}`;

export function buildChunkUserPrompt(input: {
  relativePath: string;
  chunkIndex: number;
  totalChunks: number;
  startLine: number;
  endLine: number;
  content: string;
}): string {
  return `File path: ${input.relativePath}
Chunk ${input.chunkIndex + 1} of ${input.totalChunks} (lines ${input.startLine}-${input.endLine}).
Chunk content:
${input.content}`;
}
