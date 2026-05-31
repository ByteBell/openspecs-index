/**
 * Narrows the `public_signatures` and `type_shapes` arrays into structured entries. Both
 * carry verbatim source — `signature` and `shape` are byte-for-byte copies; the parser keeps
 * them as-is and does NOT normalise whitespace.
 */
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  PublicSignature,
  TypeShape,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/substrate.ts";
import {
  pickBool,
  pickRecordArray,
} from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import { parseSourceAnchor } from "./anchors.ts";

const TYPE_SHAPE_KINDS: ReadonlySet<TypeShape["kind"]> = new Set([
  "interface",
  "type",
  "enum",
  "union",
  "intersection",
  "tuple",
  "alias",
]);

/** Returns the string at `key`, or null when absent/empty. */
function optString(rec: Record<string, unknown>, key: string): string | null {
  return typeof rec[key] === "string" && (rec[key] as string).length > 0 ? (rec[key] as string) : null;
}

/**
 * Parses the untrusted `public_signatures` array into {@link PublicSignature}s.
 *
 * @param value - The untrusted `public_signatures` field.
 * @returns The parsed signatures (entries without a name or signature are dropped).
 */
export function parsePublicSignatures(value: unknown): PublicSignature[] {
  const out: PublicSignature[] = [];
  for (const rec of pickRecordArray(value)) {
    const name = pickString(rec["name"], "");
    const signature = pickString(rec["signature"], "");
    if (name.length === 0 || signature.length === 0) {
      continue;
    }
    out.push({
      kind: pickString(rec["kind"], "unknown"),
      name,
      signature,
      generics: optString(rec, "generics"),
      decorators: pickStringArray(rec["decorators"]),
      returnType: optString(rec, "return_type"),
      exported: pickBool(rec["exported"]),
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}

/**
 * Parses the untrusted `type_shapes` array into {@link TypeShape}s.
 *
 * @param value - The untrusted `type_shapes` field.
 * @returns The parsed shapes (entries without a name or shape are dropped).
 */
export function parseTypeShapes(value: unknown): TypeShape[] {
  const out: TypeShape[] = [];
  for (const rec of pickRecordArray(value)) {
    const name = pickString(rec["name"], "");
    const shape = pickString(rec["shape"], "");
    if (name.length === 0 || shape.length === 0) {
      continue;
    }
    const kindRaw = pickString(rec["kind"], "alias");
    const kind: TypeShape["kind"] = TYPE_SHAPE_KINDS.has(kindRaw as TypeShape["kind"])
      ? (kindRaw as TypeShape["kind"])
      : "alias";
    out.push({
      kind,
      name,
      shape,
      discriminant: optString(rec, "discriminant"),
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}
