/**
 * Parser for the `units` array of a Prompt 1 response into {@link UnitDescriptor}s. The model is
 * NOT asked to echo unit bodies back — they are reconstructed locally by slicing the input source
 * at the model-reported `[start_line, end_line]` (1-based, inclusive). This avoids paying output
 * tokens for verbatim source and removes whitespace-drift risk from the LLM. A descriptor is
 * dropped only when the reconstructed slice is empty (e.g. the model returned 0/0 line numbers).
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import { buildUnitId } from "#src/strategies/intermediate-representation/file-analysis/unit-id.ts";
import { pickBool, pickInt, pickRecordArray } from "./primitives.ts";

/** Cheap line-slice; treats start_line/end_line as 1-based inclusive, no clamping. */
function sliceLines(sourceLines: readonly string[], startLine: number, endLine: number): string {
  if (startLine < 1 || endLine < startLine) {
    return "";
  }
  return sourceLines.slice(startLine - 1, endLine).join("\n");
}

/**
 * Parses one untrusted record into a {@link UnitDescriptor}, or null when the reconstructed slice
 * is empty.
 *
 * @param rec - The untrusted unit record.
 * @param fileNodeId - The file id used to recompute the unit id when absent.
 * @param sourceLines - The source string the LLM was given, pre-split by "\n", for the slice.
 * @returns The descriptor, or `null` to drop it.
 */
/** Extracts the qualified-name segment from an LLM-emitted id like `<prefix>#<kind>:<qn>`. */
export function qnFromLlmId(id: string): string | null {
  const hash = id.indexOf("#");
  if (hash < 0) {
    return null;
  }
  const colon = id.indexOf(":", hash + 1);
  return colon < 0 ? null : id.slice(colon + 1);
}

function parseOne(
  rec: Record<string, unknown>,
  fileNodeId: string,
  sourceLines: readonly string[],
): UnitDescriptor | null {
  const startLine = pickInt(rec["start_line"], 0);
  const endLine = pickInt(rec["end_line"], 0);
  const source = sliceLines(sourceLines, startLine, endLine);
  if (source.length === 0) {
    return null;
  }
  const unitKind = pickString(rec["unit_kind"], "unknown");
  const name = pickString(rec["name"], "");
  const qualifiedName = pickString(rec["qualified_name"], name);
  // We never trust the LLM's emitted unit_id — it is rebuilt canonically so every per-unit
  // record carries the same `<fileNodeId>__<qn>#<kind>:<qn>` shape, regardless of which
  // prefix the model echoed back.
  const unitId = buildUnitId(fileNodeId, unitKind, qualifiedName);
  // parentUnitId is kept in the LLM-emitted form here; `remapParentUnitIds` rewrites it once
  // every descriptor's canonical id is known.
  const parentUnitId =
    typeof rec["parent_unit_id"] === "string" && (rec["parent_unit_id"] as string).length > 0
      ? (rec["parent_unit_id"] as string)
      : null;
  return {
    unitId,
    unitKind,
    name,
    qualifiedName,
    parentUnitId,
    startLine,
    endLine,
    isBehavioral: pickBool(rec["is_behavioral"]),
    source,
  };
}

/**
 * Rewrites each descriptor's `parentUnitId` from the LLM-emitted form to the canonical
 * `<fileNodeId>__<qn>#<kind>:<qn>` form, by looking up the parent's qualified-name.
 */
export function remapParentUnitIds(descriptors: UnitDescriptor[]): void {
  const byQn = new Map<string, string>();
  for (const d of descriptors) {
    byQn.set(d.qualifiedName, d.unitId);
  }
  for (const d of descriptors) {
    if (d.parentUnitId === null) {
      continue;
    }
    const parentQn = qnFromLlmId(d.parentUnitId);
    d.parentUnitId = parentQn !== null ? (byQn.get(parentQn) ?? null) : null;
  }
}

/**
 * Parses the `units` array of a Prompt 1 response into ordered {@link UnitDescriptor}s.
 *
 * @param value - The untrusted `units` field.
 * @param fileNodeId - The file id used to recompute unit ids when absent.
 * @param source - The verbatim file (or chunk) text the LLM was given; used to slice unit bodies.
 * @returns The descriptors in source order (possibly empty).
 */
export function parseUnitDescriptors(value: unknown, fileNodeId: string, source: string): UnitDescriptor[] {
  const sourceLines = source.split("\n");
  const out: UnitDescriptor[] = [];
  for (const rec of pickRecordArray(value)) {
    const descriptor = parseOne(rec, fileNodeId, sourceLines);
    if (descriptor !== null) {
      out.push(descriptor);
    }
  }
  remapParentUnitIds(out);
  return out;
}
