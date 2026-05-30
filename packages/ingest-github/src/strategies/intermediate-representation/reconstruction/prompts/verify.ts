/**
 * Prompt 3 — Round-Trip Verifier (fidelity gate, per unit). Step 1 regenerates source from the
 * IR alone (raw code out); Step 2 compares regenerated source to the original (JSON report).
 */

export const REGENERATE_SYSTEM_PROMPT = `You regenerate source code from a reconstruction IR. Output ONLY code — no prose, no markdown
fences, no commentary. Match the signature, control flow, literals, visibility/mutability, and
I/O exactly as described by the IR. Behave deterministically.`;

/**
 * Builds the Prompt 3.1 user message: regenerate the unit's source from its IR only.
 *
 * @param input - The unit kind and its serialized IR JSON.
 * @returns The user-message string sent to `askLLM` alongside `REGENERATE_SYSTEM_PROMPT`.
 */
export function buildRegenerateUserPrompt(input: { unitKind: string; irJson: string }): string {
  return `Regenerate the exact source for this ${input.unitKind} using ONLY the IR below.
Match signature, control flow, literals, visibility/mutability, and I/O exactly.
Output code only.
IR:
${input.irJson}`;
}

const EQUIVALENCE_JSON_SHAPE = `Return JSON with EXACTLY these keys:
{
  "semantic_equivalent": false,
  "passing_example_io": 0,
  "total_example_io": 0,
  "missing_from_ir": ["behavior in ORIGINAL not captured by the IR"],
  "reconstruction_completeness": 0.0
}`;

export const EQUIVALENCE_SYSTEM_PROMPT = `You compare an ORIGINAL code unit to a REGENERATED one and judge semantic equivalence. List
any behavior present in the ORIGINAL that the regenerated source fails to reproduce under
missing_from_ir. Output JSON only — no prose, no markdown fences. Behave deterministically.

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
