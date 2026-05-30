/**
 * Prompt 2 — Unit IR Extractor (one call per unit). Produces the reconstruction-grade IR for
 * ONE code unit so another model can regenerate its exact source.
 */
import { UNIT_IR_JSON_SHAPE } from "./unit-ir-fields.ts";

export const UNIT_IR_SYSTEM_PROMPT = `You produce a RECONSTRUCTION-GRADE IR for ONE code unit of a given unit_kind, in any
language. The IR must let another model regenerate the unit's exact source. Fields are
ADAPTIVE: fill what applies to this unit_kind, set the rest to null/[]/{}. Do NOT invent.
Preserve all literals EXACTLY (regexes, format strings, magic numbers, enum values, addresses,
inline assembly) in constants / verbatim_blocks.

For BEHAVIORAL units (function/method/modifier/macro/constructor):
- logic_outline must use ONLY step types "sequence","branch","loop","return","raise","call",
  "emit"; nest children under branch/loop. Capture EVERY conditional and loop bound — a missed
  outer condition is the top cause of reconstruction failure.
- example_io_pairs must be TRUE of the code as written (trace it), not aspirational.

For CONTAINER/TYPE units (class/struct/contract/impl/trait/interface/enum):
- fill base_types, implements, members, member_unit_ids; logic fields stay empty.

Output a single JSON object, no prose, no markdown fences. Behave deterministically.

${UNIT_IR_JSON_SHAPE}`;

/**
 * Builds the Prompt 2 user message for one unit. `mustCapture` carries `missing_from_ir` hints
 * from a failed verification, appended on the single retry; empty on the first attempt.
 *
 * @param input - The unit's kind/name, language, file path, resolution context, source, and
 *                any must-capture retry hints.
 * @returns The user-message string sent to `askJsonLLM` alongside `UNIT_IR_SYSTEM_PROMPT`.
 */
export function buildUnitIrUserPrompt(input: {
  language: string;
  unitKind: string;
  qualifiedName: string;
  relativePath: string;
  context: string;
  unitSource: string;
  mustCapture: string[];
}): string {
  const hints =
    input.mustCapture.length > 0
      ? `\nMUST CAPTURE (missing from a prior attempt — do not omit again):\n${input.mustCapture.map((h) => `- ${h}`).join("\n")}\n`
      : "";
  return `LANGUAGE: ${input.language}
UNIT_KIND: ${input.unitKind}
QUALIFIED_NAME: ${input.qualifiedName}
FILE_PATH: ${input.relativePath}
CONTEXT (imports + sibling signatures, for resolution only — do not re-document):
${input.context}
${hints}UNIT SOURCE:
${input.unitSource}`;
}
