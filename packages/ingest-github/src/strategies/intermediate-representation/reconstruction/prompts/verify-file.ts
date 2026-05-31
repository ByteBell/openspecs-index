/**
 * Whole-file equivalence prompts. After every unit has been regenerated (structure only —
 * bodies replaced with a one-line placeholder), the per-unit sources are deterministically
 * stitched with the module-level header (imports, file constants, module-level code) drawn
 * from `ModuleIr`. This prompt asks the judge to compare that ASSEMBLED file against the
 * ORIGINAL file as a whole — judging file-level structural fidelity, not body semantics.
 */

const WHOLE_FILE_JSON_SHAPE = `Return JSON with EXACTLY these keys:
{
  "semantic_equivalent": false,
  "missing_from_assembly": ["file-level element in ORIGINAL not reproduced in ASSEMBLED"],
  "reconstruction_completeness_pct": 0
}

reconstruction_completeness_pct is an INTEGER 0..100 — the percentage of the ORIGINAL file's
STRUCTURE that the ASSEMBLED file reproduces. 0 = nothing recovered, 100 = fully equivalent.
Never exceed 100.`;

export const WHOLE_FILE_EQUIVALENCE_SYSTEM_PROMPT = `You compare an ORIGINAL source file to an ASSEMBLED source file and judge STRUCTURAL
equivalence at the file level.

What counts (everything outside function/method/constructor BODIES):
  • Imports / require / use statements — same modules, same imported symbols, same aliases.
  • File-level constants, variables, type aliases, enums — present with same value/type.
  • Module-level executable code (top-level statements, side effects) — present, same order.
  • Exports / re-exports / default export — same set, same names.
  • Order of declarations across the file (units appear in the same source order).
  • Every unit (function / class / interface / contract / struct / trait / module / …) is
    present with matching declaration AND every member (fields, method signatures, nested
    types, events, modifiers, decorators, generics, inheritance clauses).
  • Field initialisers, default-parameter values, decorators, attributes — verbatim.
  • Comments / docstrings attached to declarations, if both files have them.

What to IGNORE:
  • Function / method / constructor / accessor BODIES are intentionally replaced in the
    ASSEMBLED file with a one-line placeholder (e.g. \`{ /* body omitted... */ }\`,
    \`pass  # body omitted\`). DO NOT penalise omitted bodies — body equivalence is not under
    test at the file level.
  • Pure whitespace / blank-line differences between declarations.

List under missing_from_assembly any FILE-LEVEL element present in the ORIGINAL that the
ASSEMBLED file fails to reproduce (missing import, missing export, missing unit, missing
class member, wrong order, wrong field type, etc.) — never list missing bodies.

Output JSON only — no prose, no markdown fences. Behave deterministically.

${WHOLE_FILE_JSON_SHAPE}`;

/**
 * Builds the whole-file equivalence user message.
 *
 * @param input - The original file source and the assembled (from-IR) file source.
 * @returns The user-message string sent to `askJsonLLM` alongside the system prompt.
 */
export function buildWholeFileEquivalenceUserPrompt(input: {
  originalSource: string;
  assembledSource: string;
}): string {
  return `ORIGINAL:
${input.originalSource}
ASSEMBLED:
${input.assembledSource}`;
}
