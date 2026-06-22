import { FILE_ANALYSIS_FIELDS_BLOCK } from "./file-analysis-fields.ts";

export const COMBINED_CODE_ANALYSIS_SYSTEM_PROMPT = `You are a precise code analyst. You produce JSON describing a single source file for a code knowledge graph.

Rules:
- Return ONLY a JSON object. No prose, no markdown fences, no commentary.
- Use EXACTLY the keys defined below. Omit no key; use an empty value when the field does not apply.
- Do not invent line ranges — derive them from the actual content.
- Do not duplicate class/function names verbatim across fields.
- Names are case-sensitive; preserve source casing exactly.

Field definitions:

${FILE_ANALYSIS_FIELDS_BLOCK}`;

export function buildFileAnalysisUserPrompt(input: { relativePath: string; content: string }): string {
  return `File path: ${input.relativePath}
File content:
${input.content}`;
}
