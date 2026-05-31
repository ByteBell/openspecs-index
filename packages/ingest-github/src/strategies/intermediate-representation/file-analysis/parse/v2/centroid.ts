/**
 * Narrows the `representation_family` / `representation_type` scalars and the
 * `canonical_centroid` object. Defaults keep the IR total when fields are missing.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  CanonicalCentroid,
  RepresentationFamily,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/substrate.ts";
import {
  asRecord,
  pickInt,
} from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";

const FAMILIES: ReadonlySet<RepresentationFamily> = new Set([
  "module",
  "class-bag",
  "function-bag",
  "state-machine",
  "config",
  "schema",
  "script",
  "test",
  "fixture",
  "barrel",
  "binding",
  "documentation",
  "unknown",
]);

/**
 * Narrows an untrusted string to {@link RepresentationFamily}, defaulting to `"unknown"`.
 *
 * @param value - The untrusted `representation_family` field.
 * @returns A valid family.
 */
export function parseRepresentationFamily(value: unknown): RepresentationFamily {
  if (typeof value === "string" && FAMILIES.has(value as RepresentationFamily)) {
    return value as RepresentationFamily;
  }
  return "unknown";
}

/**
 * Parses the untrusted `canonical_centroid` object into a {@link CanonicalCentroid}.
 *
 * @param value - The untrusted `canonical_centroid` field.
 * @returns A total centroid; missing paragraph/token_estimate default to `""` / `0`.
 */
export function parseCanonicalCentroid(value: unknown): CanonicalCentroid {
  const rec = asRecord(value) ?? {};
  return {
    paragraph: pickString(rec["paragraph"], ""),
    tokenEstimate: pickInt(rec["token_estimate"], 0),
  };
}
