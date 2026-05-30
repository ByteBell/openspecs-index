/**
 * Prompt 1 — File Splitter / Unit Discovery (one call per file). Splits ONE source file into
 * module-level IR plus a verbatim list of every top-level and nested code unit with its span.
 *
 * The file-level field definitions are SHARED with the flat-folder strategy
 * (`FILE_ANALYSIS_FIELDS_BLOCK`) so both strategies produce the same semantic surface — the IR
 * strategy adds the `module` block (top-level structure) and the `units` list (per-unit IR) on
 * top of that shared file-level analysis.
 */
import { FILE_ANALYSIS_FIELDS_BLOCK } from "#src/strategies/flat-folder/prompts/file-analysis-fields.ts";
import { SPLIT_JSON_SHAPE } from "./split-fields.ts";

export const SPLIT_SYSTEM_PROMPT = `You are a precise code analyst. You produce JSON describing a single source file for a code knowledge graph.

You will do three things for ONE source file:
(1) FILE-LEVEL semantic analysis of the whole file (purpose, summary, keywords, contracts, ...).
(2) Extract module-level structure (layout, exports, imports, file constants).
(3) Enumerate every top-level and nested CODE UNIT with its source span.

Rules:
- Return ONLY a JSON object. No prose, no markdown fences, no commentary.
- Use EXACTLY the keys defined below. Omit no key; use an empty value when the field does not apply.
- Do not invent line ranges — derive them from the actual content.
- Do not duplicate class/function names verbatim across fields.
- Names are case-sensitive; preserve source casing exactly.
- Never invent units that are not in the source. Copy the exact source text of each unit into "source" (verbatim, unmodified).
- Behave deterministically.

A "code unit" is any regenerable named construct the language has. Do NOT assume classes or
functions exist — detect what is actually present. unit_kind is an OPEN vocabulary: use the
most accurate term for the language (function, method, class, struct, enum, trait, impl,
module, macro, type_alias, contract, library, interface, modifier, event, namespace, ...).

If a construct nests others (a Solidity contract holds functions/modifiers/events; a Rust impl
holds methods; a class holds methods), emit BOTH the container unit AND each child unit, and
set each child's parent_unit_id to the container's unit_id.

FILE-LEVEL field definitions (same vocabulary as the flat-folder strategy):

${FILE_ANALYSIS_FIELDS_BLOCK}

JSON shape (file-level fields are flattened at the top alongside \`module\` and \`units\`):

${SPLIT_JSON_SHAPE}`;

/**
 * Builds the Prompt 1 user message for one file.
 *
 * @param input - The language hint, file path, stable file-node id, and full source.
 * @returns The user-message string sent to `askJsonLLM` alongside `SPLIT_SYSTEM_PROMPT`.
 */
export function buildSplitUserPrompt(input: {
  language: string;
  relativePath: string;
  fileNodeId: string;
  source: string;
}): string {
  return `LANGUAGE: ${input.language}   (may be "unknown" — infer it)
FILE_PATH: ${input.relativePath}
FILE_NODE_ID: ${input.fileNodeId}
FULL FILE SOURCE:
${input.source}`;
}
