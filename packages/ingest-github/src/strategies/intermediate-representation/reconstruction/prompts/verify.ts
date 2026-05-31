/**
 * Prompt 3 — Round-Trip Verifier (fidelity gate, per unit). Step 1 regenerates source from the
 * IR alone (raw code out); Step 2 compares regenerated source to the original (JSON report).
 */

export const REGENERATE_SYSTEM_PROMPT = `You regenerate the FULL STRUCTURE of a source-code unit from its reconstruction IR. Output
ONLY code — no prose, no markdown fences, no commentary.

INCLUDE (must match the IR exactly):
  • The unit's own declaration: keyword, name, visibility / mutability / async / static / abstract
    modifiers, decorators / annotations, generics / type parameters, parameter list (names +
    types in order), return type, throws / error clause, extends / implements / inheritance
    clauses, view/pure/payable (Solidity), const/noexcept (C++), etc.
  • For a CONTAINER unit (class, interface, struct, trait, enum, contract, module, namespace,
    record, type alias, …): every member of the container in source order — every field with
    its type/default, every method/function/constructor/destructor SIGNATURE, every nested
    type declaration, every event / modifier / accessor. Member declarations are exhaustive.
  • All comments / docstrings attached to declarations (JSDoc, /// doc, NatSpec, etc.) if
    present in the IR.

EXCLUDE — and ONLY this:
  • The IMPLEMENTATION BODY of any function / method / constructor / accessor / modifier.
    Replace each such body with a language-appropriate one-line placeholder, e.g.
    \`{ /* body omitted: implementation may vary */ }\` for C-family / JS / TS / Java / Go /
    Rust / Solidity / Swift, \`pass  # body omitted\` for Python, \`= unimplemented()\` for
    Haskell, etc. Two bodies that satisfy the same signature and I/O contract are considered
    equivalent; bodies themselves are not under test.

Field initialisers, default-parameter values, enum values, type aliases, decorators,
attributes, and constant declarations are STRUCTURE — keep them verbatim. Behave
deterministically.`;

/**
 * Builds the Prompt 3.1 user message: regenerate the unit's full structural skeleton from IR.
 *
 * @param input - The unit kind and its serialized IR JSON.
 * @returns The user-message string sent to `askLLM` alongside `REGENERATE_SYSTEM_PROMPT`.
 */
export function buildRegenerateUserPrompt(input: { unitKind: string; irJson: string }): string {
  return `Regenerate the FULL STRUCTURE of this ${input.unitKind} using ONLY the IR below.
Emit the declaration plus every member (fields, method signatures, nested types, events,
modifiers, decorators, generics) in source order, exactly as described by the IR. Replace
function / method bodies with a one-line placeholder. Output code only.
IR:
${input.irJson}`;
}

const EQUIVALENCE_JSON_SHAPE = `Return JSON with EXACTLY these keys:
{
  "semantic_equivalent": false,
  "passing_example_io": 0,
  "total_example_io": 0,
  "missing_from_ir": ["behavior in ORIGINAL not captured by the IR"],
  "reconstruction_completeness_pct": 0
}

reconstruction_completeness_pct is an INTEGER from 0 to 100 inclusive — the percentage of the
ORIGINAL unit's behaviour that the REGENERATED unit reproduces. 0 = nothing recovered, 100 =
fully equivalent. Never exceed 100.`;

export const EQUIVALENCE_SYSTEM_PROMPT = `You compare an ORIGINAL code unit to a REGENERATED one and judge STRUCTURAL equivalence.

What counts:
  • Declaration: keyword, name, visibility / mutability / async / static / abstract / view /
    pure / payable, decorators / annotations, generics, parameter list (names + types in
    order), default values, return type, throws clause, extends / implements / inheritance.
  • For container units (class / interface / struct / trait / enum / contract / module / …):
    every member must be present with matching declaration — fields with type & initialiser,
    method / constructor SIGNATURES (parameters, return, modifiers), nested types, events,
    modifiers, accessors.
  • Field initialisers, default-parameter values, enum values, type aliases, and constants
    are structural — they must match verbatim.

What to IGNORE:
  • The REGENERATED source intentionally replaces function / method / constructor /
    accessor BODIES with a one-line placeholder (e.g. \`{ /* body omitted... */ }\`,
    \`pass  # body omitted\`). DO NOT penalise this — body equivalence is NOT under test.
    Two units with identical structure but differing bodies are fully equivalent here.

List under missing_from_ir any STRUCTURAL element present in the ORIGINAL that the
regenerated source fails to reproduce — never list missing bodies.

Output JSON only — no prose, no markdown fences. Behave deterministically.

${EQUIVALENCE_JSON_SHAPE}`;

/**
 * Builds the Prompt 3.2 user message: compare original and regenerated source.
 *
 * @param input - The original unit source and the regenerated source.
 * @returns The user-message string sent to `askJsonLLM` alongside `EQUIVALENCE_SYSTEM_PROMPT`.
 */
export function buildEquivalenceUserPrompt(input: { originalSource: string; regeneratedSource: string }): string {
  return `ORIGINAL:
${input.originalSource}
REGENERATED:
${input.regeneratedSource}`;
}
