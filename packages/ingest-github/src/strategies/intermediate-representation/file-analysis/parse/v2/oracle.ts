/**
 * Narrows the untrusted `module_contract_tests` array into {@link ModuleContractTest}[].
 * Missing/invalid entries default to safe empty values so the IR stays total.
 */
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import { pickRecordArray } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import type {
  ModuleContractTest,
  ModuleOracleKind,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/oracle.ts";

const ORACLE_KINDS: ReadonlySet<ModuleOracleKind> = new Set([
  "unit-test",
  "property",
  "integration-trace",
  "invariant-check",
  "fingerprint",
]);

function parseOracleKind(value: unknown): ModuleOracleKind {
  if (typeof value === "string" && ORACLE_KINDS.has(value as ModuleOracleKind)) {
    return value as ModuleOracleKind;
  }
  return "unit-test";
}

/**
 * Parses the untrusted `module_contract_tests` field.
 *
 * @param value - The untrusted candidate (expected to be an array of records).
 * @returns A guaranteed `ModuleContractTest[]`; empty when input is missing/invalid.
 */
export function parseModuleContractTests(value: unknown): ModuleContractTest[] {
  return pickRecordArray(value).map((rec) => ({
    testId: pickString(rec["test_id"], ""),
    scenario: pickString(rec["scenario"], ""),
    given: pickStringArray(rec["given"]),
    when: pickString(rec["when"], ""),
    then: pickString(rec["then"], ""),
    targets: pickStringArray(rec["targets"]),
    oracleKind: parseOracleKind(rec["oracle_kind"]),
    rationale: pickString(rec["rationale"], ""),
  }));
}
