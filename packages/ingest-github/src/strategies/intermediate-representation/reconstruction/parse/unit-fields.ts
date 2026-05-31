/**
 * Parsers for the structured JSON sub-fields of a `CodeUnit` (Prompt 2). Each function narrows
 * exactly one field and does nothing else; `parseCodeUnit` composes them.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  CodeUnitParameter,
  ErrorPolicy,
  ExampleIoPair,
  UnitCall,
  UnitMember,
  VerbatimBlock,
} from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import { asRecord, pickBool, pickInt, pickRecordArray } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";

/** Returns the trimmed string at `key`, or null when absent/empty. */
function optString(rec: Record<string, unknown>, key: string): string | null {
  return typeof rec[key] === "string" && (rec[key] as string).length > 0 ? (rec[key] as string) : null;
}

/**
 * Parses the `parameters` array, stamping a fallback `order` from array position.
 *
 * @param value - The untrusted `parameters` field.
 * @returns Ordered {@link CodeUnitParameter}s (entries without a name are dropped).
 */
export function parseParameters(value: unknown): CodeUnitParameter[] {
  const out: CodeUnitParameter[] = [];
  pickRecordArray(value).forEach((rec, index) => {
    const name = pickString(rec["name"], "");
    if (name.length === 0) {
      return;
    }
    out.push({
      name,
      type: optString(rec, "type"),
      default: optString(rec, "default"),
      optional: pickBool(rec["optional"]),
      variadic: pickBool(rec["variadic"]),
      order: pickInt(rec["order"], index),
    });
  });
  return out;
}

/**
 * Parses the `calls` array into {@link UnitCall}s, normalising `kind` to internal/external.
 *
 * @param value - The untrusted `calls` field.
 * @returns The parsed calls (entries without a name are dropped).
 */
export function parseCalls(value: unknown): UnitCall[] {
  const out: UnitCall[] = [];
  for (const rec of pickRecordArray(value)) {
    const name = pickString(rec["name"], "");
    if (name.length === 0) {
      continue;
    }
    out.push({ name, source: optString(rec, "source"), kind: rec["kind"] === "external" ? "external" : "internal" });
  }
  return out;
}

/**
 * Parses the `members` array of a container/type unit.
 *
 * @param value - The untrusted `members` field.
 * @returns The parsed {@link UnitMember}s (entries without a name are dropped).
 */
export function parseMembers(value: unknown): UnitMember[] {
  const out: UnitMember[] = [];
  for (const rec of pickRecordArray(value)) {
    const name = pickString(rec["name"], "");
    if (name.length === 0) {
      continue;
    }
    out.push({
      name,
      kind: pickString(rec["kind"], "field"),
      type: optString(rec, "type"),
      default: optString(rec, "default"),
      visibility: optString(rec, "visibility"),
      static: pickBool(rec["static"]),
    });
  }
  return out;
}

/**
 * Parses the `verbatim_blocks` array (regexes, templates, inline assembly preserved exactly).
 *
 * @param value - The untrusted `verbatim_blocks` field.
 * @returns The parsed {@link VerbatimBlock}s (entries with empty text are dropped).
 */
export function parseVerbatimBlocks(value: unknown): VerbatimBlock[] {
  const out: VerbatimBlock[] = [];
  for (const rec of pickRecordArray(value)) {
    const text = pickString(rec["text"], "");
    if (text.length === 0) {
      continue;
    }
    out.push({ kind: pickString(rec["kind"], "block"), text });
  }
  return out;
}

/**
 * Parses the `example_io_pairs` array (traced input/output pairs).
 *
 * @param value - The untrusted `example_io_pairs` field.
 * @returns The parsed {@link ExampleIoPair}s.
 */
export function parseExampleIoPairs(value: unknown): ExampleIoPair[] {
  return pickRecordArray(value).map((rec) => ({
    input: pickString(rec["input"], ""),
    expectedOutput: pickString(rec["expected_output"], ""),
    note: optString(rec, "note"),
  }));
}

/**
 * Parses the `error_policy` object into an {@link ErrorPolicy}.
 *
 * @param value - The untrusted `error_policy` field.
 * @returns A fully-populated error policy (empty lists / null when absent).
 */
export function parseErrorPolicy(value: unknown): ErrorPolicy {
  const rec = asRecord(value) ?? {};
  const list = (key: string): string[] => (Array.isArray(rec[key]) ? (rec[key] as unknown[]).filter(isNonEmpty) : []);
  return {
    raises: list("raises"),
    reverts: list("reverts"),
    onInvalidInput: optString(rec, "on_invalid_input"),
    returnsOnError: optString(rec, "returns_on_error"),
  };
}

/** Type guard: a non-empty string. */
function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
