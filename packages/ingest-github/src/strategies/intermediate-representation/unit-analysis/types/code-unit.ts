/**
 * The reconstruction-grade `CodeUnit` IR and its structured sub-shapes.
 *
 * One TS interface models every regenerable construct (function, class, struct, contract,
 * impl, trait, enum, modifier, macro, ...) distinguished by `unitKind` — an OPEN vocabulary.
 * Fields are ADAPTIVE: behavioral kinds fill the logic fields; container/type kinds fill the
 * membership fields; the rest stay empty.
 *
 * The LLM contract (Prompt 2) is snake_case; these camelCase fields are the parsed,
 * narrowed form. Sub-objects the Neo4j schema stores as JSON strings are kept structured
 * here and serialized only at the persistence boundary (the caller's concern).
 *
 * Note: the flat-folder semantic analysis (purpose/summary/keywords/...) is a FILE-level
 * concern and lives once on {@link ModuleIr}, not on each unit — a file has many units.
 */

/** A single declared parameter of a callable unit. */
export interface CodeUnitParameter {
  name: string;
  type: string | null;
  default: string | null;
  optional: boolean;
  variadic: boolean;
  order: number;
}

/** One step of the SCoT logic outline. `children` nest under `branch` / `loop` steps. */
export interface LogicStep {
  step: "sequence" | "branch" | "loop" | "return" | "raise" | "call" | "emit";
  desc: string;
  condition: string | null;
  children: LogicStep[];
}

/** The error/exception contract of a behavioral unit. */
export interface ErrorPolicy {
  raises: string[];
  reverts: string[];
  onInvalidInput: string | null;
  returnsOnError: string | null;
}

/** A resolved (or named) invocation made by a behavioral unit. */
export interface UnitCall {
  name: string;
  source: string | null;
  kind: "internal" | "external";
}

/** A member of a container/type unit: field, state var, enum variant, or method-by-name. */
export interface UnitMember {
  name: string;
  kind: string;
  type: string | null;
  default: string | null;
  visibility: string | null;
  static: boolean;
}

import type { UnitConstant } from "#src/strategies/intermediate-representation/file-analysis/types/named-constant.ts";
export type { UnitConstant };

/** A verbatim block kept exactly (regex, format string, template, inline assembly). */
export interface VerbatimBlock {
  kind: string;
  text: string;
}

/** An input/output pair traced from the code as written (never aspirational). */
export interface ExampleIoPair {
  input: string;
  expectedOutput: string;
  note: string | null;
}

/** A literal that is PART OF the unit's contract (not a reconstruction echo). */
export interface SpecLiteral {
  kind: string;
  value: string;
  role: string;
}

/** What kind of oracle a per-unit spec test is. */
export type UnitOracleKind =
  | "unit-test"
  | "property"
  | "invariant-check"
  | "error-path"
  | "state-transition"
  | "fingerprint";

/** One per-unit verification oracle entry. */
export interface SpecTest {
  testId: string;
  scenario: string;
  given: string[];
  when: string;
  then: string;
  oracleKind: UnitOracleKind;
  rationale: string;
}

/**
 * The full reconstruction IR for one code unit. `semanticFingerprint` is computed in code
 * (never by the LLM). Scope keys (`knowledgeId`/`orgId`) are stamped by the caller when the
 * analyzer input supplies them, otherwise left undefined for the persistence layer to fill.
 */
export interface CodeUnit {
  unitId: string;
  knowledgeId?: string | undefined;
  orgId?: string | undefined;
  fileId: string;
  unitKind: string;
  name: string;
  qualifiedName: string;
  parentUnitId: string | null;
  startLine: number;
  endLine: number;
  signature: string | null;
  parameters: CodeUnitParameter[];
  returnType: string | null;
  decorators: string[];
  modifiersApplied: string[];
  mutability: string | null;
  visibility: string | null;
  isAsync: boolean;
  isGenerator: boolean;
  isAbstract: boolean;
  isStatic: boolean;
  genericTypeParams: string[];
  logicOutline: LogicStep[];
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  edgeCases: string[];
  tieBreakingRules: string[];
  errorPolicy: ErrorPolicy;
  stateMutations: string[];
  eventsEmitted: string[];
  complexity: string | null;
  calls: UnitCall[];
  symbolReferences: string[];
  baseTypes: string[];
  implementsTypes: string[];
  members: UnitMember[];
  memberUnitIds: string[];
  constants: UnitConstant[];
  ioFormatSpec: string | null;
  verbatimBlocks: VerbatimBlock[];
  exampleIoPairs: ExampleIoPair[];
  testReferences: string[];
  /** 1-2 sentence statement of intent — what the unit guarantees, not how. */
  behaviorSummary: string;
  /** Literals that are part of the unit's contract (regex, error codes, format strings, ABI fragments). */
  specLiterals: SpecLiteral[];
  /** Constants the unit declares as part of its public contract. */
  declaredConstants: UnitConstant[];
  /** Per-unit verification oracle — checkable claims any implementation must satisfy. */
  specTests: SpecTest[];
  semanticFingerprint: string;
}
