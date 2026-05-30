/**
 * Parser for the `{name,value,kind}` constant shape, shared by the module-level `file_constants`
 * and the per-unit `constants` field. Values are preserved verbatim (they are literals).
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type { UnitConstant } from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import { pickRecordArray } from "./primitives.ts";

/**
 * Parses an untrusted array into {@link UnitConstant} entries, dropping items with no value.
 *
 * @param value - The untrusted `constants` / `file_constants` array.
 * @returns The parsed constants (possibly empty).
 */
export function parseNamedConstants(value: unknown): UnitConstant[] {
  const out: UnitConstant[] = [];
  for (const rec of pickRecordArray(value)) {
    const literal = pickString(rec["value"], "");
    if (literal.length === 0) {
      continue;
    }
    const name = typeof rec["name"] === "string" && rec["name"].length > 0 ? rec["name"] : null;
    out.push({
      name,
      value: literal,
      kind: pickString(rec["kind"], "literal"),
    });
  }
  return out;
}
