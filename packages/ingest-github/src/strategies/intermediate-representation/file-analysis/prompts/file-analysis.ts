/**
 * The IR strategy's file-analysis call (one call per file or chunk).
 *
 * Produces a VERIFIABLE SPEC for the file: a JSON record a checker can hold any implementation
 * against — current source, a hand-edit, or a regeneration in a different language. The spec
 * is the union of (a) every field flat-folder's prompt emits — the semantic layer humans rely
 * on — and (b) the structured surface + behaviour + orchestration + oracle fields defined in
 * `FILE_ANALYSIS_FIELDS_BLOCK`. See `businessLogic.md` for the theory.
 */
import { FILE_ANALYSIS_FIELDS_BLOCK, FILE_ANALYSIS_JSON_SHAPE } from "./file-analysis-fields.ts";

export const FILE_ANALYSIS_SYSTEM_PROMPT = `You are a precise code analyst. You produce JSON describing a single source file for a code knowledge graph.

The JSON you produce IS the file's verifiable spec — a record a checker can hold any
implementation (current, hand-edited, or regenerated) against. Three layers, per
businessLogic.md:
  - IDENTITY  — what the file/units are and where they live.
  - SURFACE   — the contract callers bind against (imports, signatures, types, exports).
  - BEHAVIOUR — the contract a re-implementer must preserve (effects, invariants, edges,
                errors, concurrency, state, plus \`module_contract_tests\` that *check* the
                spec).

You will do, for ONE source file:
(1) FILE-LEVEL semantic carryovers + surface + behaviour + orchestration gaps.
(2) MODULE_CONTRACT_TESTS — scenario tests that exercise the file's exports and pin invariants.
(3) Module-level structure (layout, exports, imports, file constants).
(4) Every top-level and nested CODE UNIT with its source span.

Rules:
- Return ONLY a JSON object. No prose, no markdown fences, no commentary.
- Use EXACTLY the keys defined below. Omit no key; use an empty value (empty string / empty array / null per the type) when the field does not apply.
- Do not invent line ranges — derive them from the actual content.
- Do not duplicate class/function names verbatim across fields.
- Names are case-sensitive; preserve source casing exactly.
- VERBATIM fields (public_signatures.signature, type_shapes.shape, boundary_conditions.left/right, predicate, bounds, termination_condition, module_contract_tests.given/when/then when quotable) MUST be copied byte-for-byte from the source — no paraphrasing, no whitespace normalisation. \`module_contract_tests.given/when/then\` quote source expressions when possible; if a test refers to a conceptual input not literally present (e.g. "an empty array"), describe it in plain language and mark the test with oracle_kind="property".
- Every anchor uses 1-based INCLUSIVE line numbers in the source. start_line and end_line MUST be accurate — unit bodies are reconstructed locally by slicing [start_line, end_line]. Off-by-one ranges silently corrupt the stored unit body.
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

MODULE_CONTRACT_TESTS guidance:
- Each test is a checkable claim about observable behaviour AT THE FILE BOUNDARY (an exported
  function, a route, a published event). Prefer tests that exercise multiple units when they
  collaborate; per-unit tests live on the unit itself.
- \`given\` / \`when\` / \`then\` together must be enough for a reimplementation (different
  language, different library) to verify the claim. Do NOT describe how the current code
  achieves the outcome — describe the outcome.
- \`oracle_kind\`:
    - "unit-test"          — concrete input → concrete output assertion the current code passes.
    - "property"           — quantified claim ("for any non-empty input, output preserves order").
    - "integration-trace"  — observable sequence of side effects / calls / emitted events.
    - "invariant-check"    — names an invariant from \`invariants\` that must hold after the action.
    - "fingerprint"        — claim about a deterministic identity / hash / canonical form.
- Up to 12 tests per file. Skip tests that would only restate a public_signature; signatures
  are already a checkable surface contract.
- If you cannot phrase a test without speculating about behaviour, do not invent one — record
  the gap in \`ambiguities\` instead.

Field definitions:

${FILE_ANALYSIS_FIELDS_BLOCK}

JSON shape:

${FILE_ANALYSIS_JSON_SHAPE}`;

/**
 * Builds the file-analysis user message for one file.
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
