import { createHash } from "node:crypto";

/**
 * Stable content key used to MERGE substrate nodes (invariants, edge cases,
 * assumptions, …) that share content across files. Identical content from two
 * files lands on the same node, which makes "find every file with this same
 * invariant" a single graph hop.
 *
 * Inputs are normalised — trimmed, collapsed whitespace, lowercased — so trivial
 * differences in spacing don't fragment what should be one node.
 */
export function contentHash(...parts: ReadonlyArray<string | number | boolean | null>): string {
  const h = createHash("sha1");
  for (const part of parts) {
    h.update("\x1f");
    h.update(normalise(part));
  }
  return h.digest("hex");
}

function normalise(value: string | number | boolean | null): string {
  if (value === null) return "\x00";
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
