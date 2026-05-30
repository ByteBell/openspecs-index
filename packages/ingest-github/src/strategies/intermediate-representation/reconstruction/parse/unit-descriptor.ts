/**
 * Parser for the `units` array of a Prompt 1 response into {@link UnitDescriptor}s. A descriptor
 * is dropped only when it carries no source to analyse; its `unit_id` is recomputed in code when
 * the model's is missing, so identity stays deterministic.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/reconstruction/types/module-ir.ts";
import { buildUnitId } from "#src/strategies/intermediate-representation/reconstruction/unit-id.ts";
import { pickBool, pickInt, pickRecordArray } from "./primitives.ts";

/**
 * Parses one untrusted record into a {@link UnitDescriptor}, or null when it has no source.
 *
 * @param rec - The untrusted unit record.
 * @param fileNodeId - The file id used to recompute the unit id when absent.
 * @returns The descriptor, or `null` to drop it.
 */
function parseOne(rec: Record<string, unknown>, fileNodeId: string): UnitDescriptor | null {
  const source = pickString(rec["source"], "");
  if (source.length === 0) {
    return null;
  }
  const unitKind = pickString(rec["unit_kind"], "unknown");
  const name = pickString(rec["name"], "");
  const qualifiedName = pickString(rec["qualified_name"], name);
  const parentUnitId =
    typeof rec["parent_unit_id"] === "string" && (rec["parent_unit_id"] as string).length > 0
      ? (rec["parent_unit_id"] as string)
      : null;
  const unitId = pickString(rec["unit_id"], "") || buildUnitId(fileNodeId, unitKind, qualifiedName);
  return {
    unitId,
    unitKind,
    name,
    qualifiedName,
    parentUnitId,
    startLine: pickInt(rec["start_line"], 0),
    endLine: pickInt(rec["end_line"], 0),
    isBehavioral: pickBool(rec["is_behavioral"]),
    source,
  };
}

/**
 * Parses the `units` array of a Prompt 1 response into ordered {@link UnitDescriptor}s.
 *
 * @param value - The untrusted `units` field.
 * @param fileNodeId - The file id used to recompute unit ids when absent.
 * @returns The descriptors in source order (possibly empty).
 */
export function parseUnitDescriptors(value: unknown, fileNodeId: string): UnitDescriptor[] {
  const out: UnitDescriptor[] = [];
  for (const rec of pickRecordArray(value)) {
    const descriptor = parseOne(rec, fileNodeId);
    if (descriptor !== null) {
      out.push(descriptor);
    }
  }
  return out;
}
