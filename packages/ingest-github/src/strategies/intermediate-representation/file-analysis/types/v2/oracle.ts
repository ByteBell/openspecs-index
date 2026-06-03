/**
 * Module-level verification-oracle types.
 *
 * `ModuleContractTest` is one checkable claim about the file's boundary behaviour — a scenario
 * a checker can run against any implementation (current, hand-edited, or regenerated) to
 * prove the contract still holds. The LLM emits up to 12 per file under
 * `module_contract_tests`.
 */

/** What kind of oracle the test is — narrows how a checker should run / verify it. */
export type ModuleOracleKind =
  | "unit-test"
  | "property"
  | "integration-trace"
  | "invariant-check"
  | "fingerprint";

/** One module-level scenario test exercising the file's exports. */
export interface ModuleContractTest {
  testId: string;
  scenario: string;
  given: string[];
  when: string;
  then: string;
  targets: string[];
  oracleKind: ModuleOracleKind;
  rationale: string;
}
