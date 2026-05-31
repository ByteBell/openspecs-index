/**
 * Narrows the shape + compression v2 fields: `file_fingerprint` and `reconstruction_hints`.
 * Both have defaults that keep the IR total when the field is missing or malformed.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  FileFingerprint,
  ReconstructionHints,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/shape.ts";
import {
  asRecord,
  pickInt,
} from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";

const NAMING_STYLES: ReadonlySet<ReconstructionHints["namingStyle"]> = new Set([
  "camelCase",
  "snake_case",
  "PascalCase",
  "kebab-case",
  "mixed",
  "unknown",
]);
const RETURN_STYLES: ReadonlySet<ReconstructionHints["returnStyle"]> = new Set([
  "explicit",
  "implicit-last-expr",
  "mixed",
  "n/a",
]);
const COMMENT_STYLES: ReadonlySet<ReconstructionHints["commentStyle"]> = new Set([
  "line",
  "block",
  "doc",
  "mixed",
  "none",
]);

/**
 * Parses `file_fingerprint` → {@link FileFingerprint}. Missing fields default to 0.
 */
export function parseFileFingerprint(value: unknown): FileFingerprint {
  const rec = asRecord(value) ?? {};
  return {
    lineCount: pickInt(rec["line_count"], 0),
    declarationCount: pickInt(rec["declaration_count"], 0),
    maxNestingDepth: pickInt(rec["max_nesting_depth"], 0),
    roughCyclomatic: pickInt(rec["rough_cyclomatic"], 0),
  };
}

/**
 * Parses `reconstruction_hints` → {@link ReconstructionHints}. Closed-enum fields fall back
 * to safe defaults; `dialect` is free-form.
 */
export function parseReconstructionHints(value: unknown): ReconstructionHints {
  const rec = asRecord(value) ?? {};
  const namingRaw = pickString(rec["naming_style"], "unknown");
  const returnRaw = pickString(rec["return_style"], "n/a");
  const commentRaw = pickString(rec["comment_style"], "none");
  return {
    namingStyle: NAMING_STYLES.has(namingRaw as ReconstructionHints["namingStyle"])
      ? (namingRaw as ReconstructionHints["namingStyle"])
      : "unknown",
    returnStyle: RETURN_STYLES.has(returnRaw as ReconstructionHints["returnStyle"])
      ? (returnRaw as ReconstructionHints["returnStyle"])
      : "n/a",
    commentStyle: COMMENT_STYLES.has(commentRaw as ReconstructionHints["commentStyle"])
      ? (commentRaw as ReconstructionHints["commentStyle"])
      : "none",
    dialect: pickString(rec["dialect"], ""),
  };
}
