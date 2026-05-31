/**
 * The IR strategy's file-analysis call (one call per file or chunk). Asks the model to produce
 * a file-level analysis + module-level structure + verbatim list of every top-level and nested
 * code unit with its span.
 *
 * The file-level field definitions are the v2 IR field block (`FILE_ANALYSIS_FIELDS_BLOCK_V2`),
 * forked from flat-folder's block and extended with the reconstruction substrate, error-aware,
 * orchestration, shape, and reshape fields. Flat-folder's block is unchanged.
 */
import { FILE_ANALYSIS_FIELDS_BLOCK_V2 } from "./file-analysis-fields-v2.ts";
import { FILE_ANALYSIS_JSON_SHAPE } from "./file-analysis-fields.ts";

export const FILE_ANALYSIS_SYSTEM_PROMPT = `You are a precise code analyst. You produce JSON describing a single source file for a code knowledge graph.

You will do three things for ONE source file:
(1) FILE-LEVEL semantic analysis of the whole file (carryover, reshaped, and v2 substrate fields).
(2) Extract module-level structure (layout, exports, imports, file constants).
(3) Enumerate every top-level and nested CODE UNIT with its source span.

Rules:
- Return ONLY a JSON object. No prose, no markdown fences, no commentary.
- Use EXACTLY the keys defined below. Omit no key; use an empty value (empty string / empty array / null per the type) when the field does not apply.
- Do not invent line ranges — derive them from the actual content.
- Do not duplicate class/function names verbatim across fields.
- Names are case-sensitive; preserve source casing exactly.
- VERBATIM fields (verbatim_literals.value, public_signatures.signature, type_shapes.shape, boundary_conditions.left/right, predicate, bounds, termination_condition) MUST be copied byte-for-byte from the source — no paraphrasing, no whitespace normalisation.
- Every anchor uses 1-based inclusive line numbers in the source. start_line and end_line MUST be accurate — the unit's verbatim source is reconstructed locally by slicing the file at [start_line, end_line] (1-based, inclusive). Off-by-one ranges silently corrupt the stored unit body.
- Never invent units that are not in the source. Do NOT emit a "source" field on units — it is reconstructed locally from start_line/end_line.
- For pass-2-only fields (resolvedRelativePath, resolvedFileId on imports / contracts; ambiguities.resolution), emit null — the mcp-enrichment strategy fills them later.
- Behave deterministically.

A "code unit" is any regenerable named construct the language has. Do NOT assume classes or
functions exist — detect what is actually present. unit_kind is an OPEN vocabulary: use the
most accurate term for the language (function, method, class, struct, enum, trait, impl,
module, macro, type_alias, contract, library, interface, modifier, event, namespace, ...).

If a construct nests others (a Solidity contract holds functions/modifiers/events; a Rust impl
holds methods; a class holds methods), emit BOTH the container unit AND each child unit, and
set each child's parent_unit_id to the container's unit_id.

FILE-LEVEL field definitions (IR v2 vocabulary):

${FILE_ANALYSIS_FIELDS_BLOCK_V2}

JSON shape (file-level fields are flattened at the top alongside \`module\` and \`units\`):

${FILE_ANALYSIS_JSON_SHAPE}`;

/**
 * Builds the Prompt 1 user message for one file.
 *
 * @param input - The language hint, file path, stable file-node id, and full source.
 * @returns The user-message string sent to `askJsonLLM` alongside `FILE_ANALYSIS_SYSTEM_PROMPT`.
 */
export function buildFileAnalysisUserPrompt(input: {
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
