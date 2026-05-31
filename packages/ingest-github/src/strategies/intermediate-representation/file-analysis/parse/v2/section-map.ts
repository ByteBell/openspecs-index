/**
 * Narrows the reshaped `section_map` array into {@link SectionMapEntry}s. The v1 free-prose
 * `description` is GONE; sections are now described by `intent` + `structureKind` + (when
 * applicable) `predicate` / `branchOutcomes` / `bounds` / `terminationCondition`, each anchored.
 */
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  SectionMapEntry,
  StructureKind,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/shape.ts";
import { pickRecordArray } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import { parseSourceAnchor } from "./anchors.ts";

const STRUCTURE_KINDS = new Set<StructureKind>([
  "sequence",
  "branch",
  "loop",
  "try",
  "async",
  "generator",
  "recursion",
  "io",
  "declaration",
]);

/** Narrows an untrusted string to {@link StructureKind}, defaulting to `"sequence"`. */
function pickStructureKind(value: unknown): StructureKind {
  if (typeof value === "string" && STRUCTURE_KINDS.has(value as StructureKind)) {
    return value as StructureKind;
  }
  return "sequence";
}

/** Optional-string helper — returns the trimmed string at `key`, or null when absent/empty. */
function optString(rec: Record<string, unknown>, key: string): string | null {
  return typeof rec[key] === "string" && (rec[key] as string).length > 0 ? (rec[key] as string) : null;
}

/**
 * Parses the untrusted `section_map` array into {@link SectionMapEntry}s.
 *
 * @param value - The untrusted `section_map` field.
 * @returns The parsed entries (entries without a name are dropped).
 */
export function parseSectionMap(value: unknown): SectionMapEntry[] {
  const out: SectionMapEntry[] = [];
  for (const rec of pickRecordArray(value)) {
    const name = pickString(rec["name"], "");
    if (name.length === 0) {
      continue;
    }
    out.push({
      name,
      intent: pickString(rec["intent"], ""),
      structureKind: pickStructureKind(rec["structure_kind"]),
      predicate: optString(rec, "predicate"),
      branchOutcomes: pickStringArray(rec["branch_outcomes"]),
      bounds: optString(rec, "bounds"),
      terminationCondition: optString(rec, "termination_condition"),
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}
