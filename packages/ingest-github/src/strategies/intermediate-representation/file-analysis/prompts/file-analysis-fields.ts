/**
 * Field-definition block and exact JSON shape the file-analysis call must emit.
 *
 * Single source of truth for the file-level prompt contract. The shape is a *verifiable spec*
 * (see `businessLogic.md`) — a record a checker can hold any implementation (current,
 * hand-edited, or regenerated) against. It is the union of:
 *
 *   - Every field flat-folder's file-analysis prompt emits (the semantic layer humans rely on).
 *   - Structured surface + behaviour contracts (signatures, types, effects, invariants, edges,
 *     errors, concurrency, state).
 *   - Orchestration gaps pass-2 closes (assumptions, ambiguities).
 *   - The module-level oracle (`module_contract_tests`) — checkable claims about the boundary.
 *
 * Reconstruction-only material (free-form internal traces, byte-for-byte literals, canonical-
 * centroid prose, cosmetic style hints, file-shape counters) is NOT asked of the LLM. Where
 * the IR type still carries such slots (because downstream storage reads them) the parser
 * fills empty defaults. Fingerprints are computed deterministically in code
 * (`file-analysis/fingerprint.ts`), never by the LLM.
 */
export const FILE_ANALYSIS_FIELDS_BLOCK = `=== Semantic carryovers (every field flat-folder's prompt emits) ===

- purpose             : string  — Authoritative explanation of why this file exists and how it fits in the system. No speculation. Empty string only if purpose cannot be inferred. Max ~300 tokens.
- summary             : string  — Natural-language summary of the file's purpose, key patterns, architecture role, and important concepts. Plain English paragraph. NO JSON, NO key-value pairs. Do NOT duplicate class/function names verbatim. Max 600 tokens.
- businessContext     : string  — 2-3 lines on the business/product domain this file serves, why it matters, and what breaks if it fails. Max ~100 tokens.
- language            : string  — Lowercase canonical name (typescript, python, go, dockerfile, markdown, ...). "unknown" if not confidently identifiable.
- classes             : string[] — Every structural/type definition. Format: "ExactName (~L3-29): What it represents". 8-15 words per entry. Preserve casing.
- functions           : string[] — Every callable definition. Format: "exact_name (~L3-29): Primary responsibility". 8-15 words per entry. Preserve casing.
- keywords            : string[] — Up to 10 technical domain keywords/phrases for search. No generic terms.
- ontologyConcepts    : string[] — Abstract concepts the file embodies. Max 8 entries.
- businessEntities    : string[] — Domain nouns the code manipulates (e.g. "User", "Invoice"). Max 8 entries.
- systemCapabilities  : string[] — Capabilities the file contributes. Action-oriented phrases. Max 6 entries.
- configDependencies  : string[] — Config keys, env vars, or settings the file reads. Exact key names.
- data_flow_direction : string  — One of: "inbound" (consumes external input), "outbound" (emits to external systems), "internal" (no external boundary crossed), "bidirectional". Empty string if ambiguous.

=== Surface contract (what callers bind against) ===

- imports_internal    : Array<{spec, symbols[], anchor}> — One entry per RELATIVE import. \`spec\` = verbatim path. \`symbols\` = named bindings. Pass-2 fills resolvedRelativePath / resolvedFileId.
- imports_external    : Array<{spec, symbols[], package?, anchor}> — One entry per third-party / stdlib import.
- contracts_provided  : Array<{name, shape}> — Public exports / endpoints / interfaces the file exposes. \`shape\` = verbatim signature, route, or schema fragment.
- contracts_consumed  : Array<{name, shape}> — Public exports / endpoints / interfaces this file depends on. Same shape.
- integration_surface : string[] — External systems touched, EACH prefixed: \`api_call:\`, \`event_pub:\`, \`event_sub:\`, \`table_read:\`, \`table_write:\`, \`grpc:\`, \`queue:\`, \`shared_schema:\`, \`ws:\`, \`fs:\`.
- public_signatures   : Array<{kind, name, signature, generics, decorators, return_type, exported, anchor}> — Every exported (and locally-relevant) declaration's VERBATIM signature. Preserve whitespace.
- type_shapes         : Array<{kind, name, shape, discriminant, anchor}> — Every interface/type/enum/union with its EXACT body in \`shape\` (verbatim). For tagged unions set \`discriminant\` to the discriminating field.
- representation_family : closed enum — module | class-bag | function-bag | state-machine | config | schema | script | test | fixture | barrel | binding | documentation | unknown.

=== Behaviour contract (what a re-implementer must preserve) ===

- side_effects        : {io, network, env, fs, process, mutation_of_arg} — Each bucket = list of one-line observable effects. Empty arrays for buckets with no effects. (Replaces flat-folder's flat \`sideEffects\` string list with categorized buckets — the same content, categorized.)
- section_map         : Array<SectionMapEntry> — Up to 8 entries. Each:
    name                   : section identifier
    intent                 : what the section ACCOMPLISHES (max ~15 words)
    structure_kind         : sequence | branch | loop | try | async | generator | recursion | io | declaration
    predicate              : verbatim guard expression when structure_kind=branch|loop, else null
    branch_outcomes        : ordered branch labels when structure_kind=branch, else []
    bounds                 : verbatim iteration bound when structure_kind=loop, else null
    termination_condition  : verbatim termination expression when structure_kind=loop|recursion, else null
    anchor                 : line span
- invariants          : Array<{kind, description, anchor}> — Pre/post-conditions, non-null promises, ordering invariants the file relies on. \`kind\` ∈ precondition | postcondition | non-null | ordering | invariant. One line each.
- edge_cases          : Array<{input_shape, handled, behavior, anchor}> — Distinct input shapes (empty, oversized, malformed, boundary), whether the code handles each, and what it does.
- boundary_conditions : Array<{operator, left, right, inclusive, intent, anchor}> — EVERY \`<\`, \`<=\`, \`>\`, \`>=\`, \`==\`, \`!=\` in the file with verbatim \`left\` / \`right\` and a one-line \`intent\`.
- error_handling      : Array<{thrown, caught, action, fallback, anchor}> — Each error path: what is thrown OR caught, what action is taken, what fallback is returned. Anchor to the throw/catch site.
- concurrency_model   : {kind, reentrant, ordering, notes} — \`kind\` ∈ sync | async | streaming | event | generator | mixed. \`reentrant\` = safe to call again before the previous completes. \`ordering\` ∈ fifo | lifo | unordered | deterministic | non-deterministic | unknown.
- state_model         : {states[], initial_state, final_states[], transitions[]} OR null — Populate ONLY when representation_family = "state-machine". Each transition: {from, to, trigger, guard?, effect?, anchor}.

=== Orchestration gaps (closed by pass-2) ===

- assumptions         : Array<{kind, description, anchor}> — Non-obvious assumptions. \`kind\` ∈ caller | env | config | init-order | platform | schema. Example: caller-must-await, env-NODE_ENV-set.
- ambiguities         : Array<{question, affects, anchor}> — TBDs the analyzer cannot resolve from this file alone. \`affects\` names the field/area this gap blocks. Pass-2 clears these.

=== Module-level verification oracle ===

- module_contract_tests : Array<ModuleContractTest> — File-level scenario tests a checker can run against any implementation to prove the contract still holds. Up to 12 entries. Each:
    test_id              : stable kebab-case slug (e.g. "rejects-empty-payload")
    scenario             : one-sentence description of the situation under test
    given                : verbatim precondition / setup expression(s) — array of strings, may be empty
    when                 : verbatim action or call expression — string (the trigger)
    then                 : verbatim observable outcome / assertion — string
    targets              : array of unit_id(s) this test exercises (cross-unit if more than one)
    oracle_kind          : unit-test | property | integration-trace | invariant-check | fingerprint
    rationale            : one line on WHY this test pins the contract (which invariant or edge case it guards). Skip if obvious from \`then\`; else max ~20 words.
  Tests describe BEHAVIOUR humans sign off on, not implementation. Phrase them so any
  reimplementation (different language, different library) can be checked against the same test.

=== Anchor convention ===

Every \`anchor\` is { "start_line": <int>, "end_line": <int> } with INCLUSIVE 1-based line numbers in the source. Single-line facts: start_line === end_line.`;

/** Exact JSON shape the file-analysis call must emit. Snake_case keys mirror the block above. */
export const FILE_ANALYSIS_JSON_SHAPE = `Return JSON with EXACTLY these keys:
{
  "language": "string",

  "_semantic": "Flat-folder semantic carryovers (every field):",
  "purpose": "string",
  "summary": "string",
  "businessContext": "string",
  "classes": ["string"],
  "functions": ["string"],
  "keywords": ["string"],
  "ontologyConcepts": ["string"],
  "businessEntities": ["string"],
  "systemCapabilities": ["string"],
  "configDependencies": ["string"],
  "data_flow_direction": "inbound|outbound|internal|bidirectional|",

  "_surface": "Surface contract:",
  "imports_internal": [
    { "spec": "./x", "symbols": ["A"], "anchor": { "start_line": 1, "end_line": 1 } }
  ],
  "imports_external": [
    { "spec": "lodash", "symbols": ["debounce"], "package": "lodash", "anchor": { "start_line": 1, "end_line": 1 } }
  ],
  "contracts_provided": [{ "name": "string", "shape": "verbatim" }],
  "contracts_consumed": [{ "name": "string", "shape": "verbatim" }],
  "integration_surface": ["channel-prefixed entries"],
  "public_signatures": [
    {
      "kind": "function|class|interface|method|...",
      "name": "string",
      "signature": "VERBATIM",
      "generics": "verbatim or null",
      "decorators": ["verbatim"],
      "return_type": "verbatim or null",
      "exported": false,
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "type_shapes": [
    {
      "kind": "interface|type|enum|union|intersection|tuple|alias",
      "name": "string",
      "shape": "VERBATIM body",
      "discriminant": "string or null",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "representation_family": "module|class-bag|function-bag|state-machine|config|schema|script|test|fixture|barrel|binding|documentation|unknown",

  "_behaviour": "Behaviour contract:",
  "side_effects": {
    "io": ["..."], "network": ["..."], "env": ["..."],
    "fs": ["..."], "process": ["..."], "mutation_of_arg": ["..."]
  },
  "section_map": [
    {
      "name": "string",
      "intent": "string",
      "structure_kind": "sequence|branch|loop|try|async|generator|recursion|io|declaration",
      "predicate": "verbatim or null",
      "branch_outcomes": ["..."],
      "bounds": "verbatim or null",
      "termination_condition": "verbatim or null",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "invariants": [
    {
      "kind": "precondition|postcondition|non-null|ordering|invariant",
      "description": "one line",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "edge_cases": [
    { "input_shape": "string", "handled": false, "behavior": "string",
      "anchor": { "start_line": 0, "end_line": 0 } }
  ],
  "boundary_conditions": [
    {
      "operator": "<|<=|>|>=|==|!=",
      "left": "verbatim",
      "right": "verbatim",
      "inclusive": false,
      "intent": "string",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "error_handling": [
    {
      "thrown": "string or null",
      "caught": "string or null",
      "action": "string",
      "fallback": "string or null",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "concurrency_model": {
    "kind": "sync|async|streaming|event|generator|mixed",
    "reentrant": false,
    "ordering": "fifo|lifo|unordered|deterministic|non-deterministic|unknown",
    "notes": "string"
  },
  "state_model": {
    "states": ["..."],
    "initial_state": "string or null",
    "final_states": ["..."],
    "transitions": [
      {
        "from": "string", "to": "string", "trigger": "string",
        "guard": "verbatim or null", "effect": "string or null",
        "anchor": { "start_line": 0, "end_line": 0 }
      }
    ]
  },

  "_orchestration": "Gaps pass-2 closes:",
  "assumptions": [
    { "kind": "caller|env|config|init-order|platform|schema",
      "description": "one line",
      "anchor": { "start_line": 0, "end_line": 0 } }
  ],
  "ambiguities": [
    { "question": "string", "affects": "string",
      "anchor": { "start_line": 0, "end_line": 0 } }
  ],

  "_module_oracle": "File-level verification oracle:",
  "module_contract_tests": [
    {
      "test_id": "kebab-case-slug",
      "scenario": "one-sentence situation under test",
      "given": ["verbatim setup expression(s)"],
      "when": "verbatim trigger expression",
      "then": "verbatim observable outcome",
      "targets": ["unit_id"],
      "oracle_kind": "unit-test|property|integration-trace|invariant-check|fingerprint",
      "rationale": "one line, or empty"
    }
  ],

  "module": {
    "module_layout": ["top-level declarations in source order"],
    "module_level_code": "top-level statements / __main__ / pragma / use/import block / SPDX header, or null",
    "exports": ["public symbols the module exposes"],
    "import_symbol_map": [
      { "symbol": "string", "module": "string", "alias": "string|null", "kind": "internal|external" }
    ],
    "file_constants": [
      { "name": "string|null", "value": "verbatim literal", "kind": "string" }
    ]
  },
  "units": [
    {
      "unit_id": "{FILE_NODE_ID}#{unit_kind}:{qualified_name}",
      "unit_kind": "open vocabulary (function|method|class|struct|enum|trait|impl|interface|contract|library|modifier|event|module|macro|type_alias|...)",
      "name": "string",
      "qualified_name": "parent-qualified name",
      "parent_unit_id": "container unit_id, or null",
      "start_line": 0,
      "end_line": 0,
      "is_behavioral": false
    }
  ]
}`;
