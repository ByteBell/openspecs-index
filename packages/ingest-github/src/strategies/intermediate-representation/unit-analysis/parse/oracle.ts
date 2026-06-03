/**
 * Parsers for the per-unit verifiable-spec additions: `spec_literals` and `spec_tests`.
 * Missing/invalid entries default to safe empty values so `CodeUnit` stays total.
 */
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import { pickRecordArray } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import type {
  SpecLiteral,
  SpecTest,
  UnitOracleKind,
} from "#src/strategies/intermediate-representation/unit-analysis/types/code-unit.ts";

const UNIT_ORACLE_KINDS: ReadonlySet<UnitOracleKind> = new Set([
  "unit-test",
  "property",
  "invariant-check",
  "error-path",
  "state-transition",
  "fingerprint",
]);

function parseUnitOracleKind(value: unknown): UnitOracleKind {
  if (typeof value === "string" && UNIT_ORACLE_KINDS.has(value as UnitOracleKind)) {
    return value as UnitOracleKind;
  }
  return "unit-test";
}

/**
 * Parses the untrusted `spec_literals` array.
 *
 * @param value - The untrusted candidate (expected to be an array of records).
 * @returns A guaranteed `SpecLiteral[]`; empty when input is missing/invalid.
 */
export function parseSpecLiterals(value: unknown): SpecLiteral[] {
  return pickRecordArray(value).map((rec) => ({
    kind: pickString(rec["kind"], ""),
    value: pickString(rec["value"], ""),
    role: pickString(rec["role"], ""),
  }));
}

/**
 * Parses the untrusted `spec_tests` array.
 *
 * @param value - The untrusted candidate (expected to be an array of records).
 * @returns A guaranteed `SpecTest[]`; empty when input is missing/invalid.
 */
export function parseSpecTests(value: unknown): SpecTest[] {
  return pickRecordArray(value).map((rec) => ({
    testId: pickString(rec["test_id"], ""),
    scenario: pickString(rec["scenario"], ""),
    given: pickStringArray(rec["given"]),
    when: pickString(rec["when"], ""),
    then: pickString(rec["then"], ""),
    oracleKind: parseUnitOracleKind(rec["oracle_kind"]),
    rationale: pickString(rec["rationale"], ""),
  }));
}
