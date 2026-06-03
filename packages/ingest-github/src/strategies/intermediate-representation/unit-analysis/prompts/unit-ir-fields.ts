/**
 * Field-definition block and exact JSON shape the per-unit (codeUnit) analysis call must emit.
 *
 * Single source of truth for the unit-level prompt contract. The shape is a *verifiable spec*
 * for one code unit — the contract a checker (types, tests, properties) will hold any
 * implementation against. Per `businessLogic.md`:
 *
 *   - SURFACE  : signature, parameters, return, generics, decorators, modifiers, visibility.
 *   - BEHAVIOUR: preconditions, postconditions, invariants, edge cases, error policy, state
 *                mutations, events, calls, symbol references, I/O format.
 *   - ORACLE   : `spec_tests` — up to 8 checkable claims about the unit's observable behaviour.
 *
 * Implementation-trace material (free-form nested logic outlines, full code echoes, advisory
 * complexity hints, ad-hoc example pairs) is NOT asked of the LLM. Where the IR type still
 * carries such slots (because downstream storage reads them) the parser fills empty defaults.
 * `semanticFingerprint` is computed deterministically in code, never by the LLM.
 */
export const UNIT_IR_JSON_SHAPE = `Return JSON with EXACTLY these keys (set null/[]/{} when N/A):
{
  "_identity": "Echoed from the file-analysis pass:",
  "unit_id": "string",
  "unit_kind": "string",
  "name": "string",
  "qualified_name": "string",
  "parent_unit_id": "string|null",

  "_surface": "Surface contract — what callers bind against:",
  "signature": "VERBATIM signature including parameter names, defaults, return type, generics, decorators, or null",
  "parameters": [
    {
      "name": "string",
      "type": "verbatim type or null",
      "default": "verbatim default expression or null",
      "optional": false,
      "variadic": false,
      "order": 0
    }
  ],
  "return_type": "verbatim or null",
  "decorators": ["@decorator / #[attr] / annotation — verbatim"],
  "modifiers_applied": ["applied modifiers, e.g. onlyOwner"],
  "mutability": "pure|view|payable|nonpayable|mut|const|null",
  "visibility": "public|private|external|internal|protected|pub|null",
  "is_async": false,
  "is_generator": false,
  "is_abstract": false,
  "is_static": false,
  "generic_type_params": ["type/template/lifetime params — verbatim"],
  "base_types": ["superclasses / inherited contracts / base structs"],
  "implements": ["interfaces / traits / protocols implemented"],
  "members": [
    {
      "name": "string", "kind": "string",
      "type": "verbatim or null", "default": "verbatim or null",
      "visibility": "string|null", "static": false
    }
  ],
  "member_unit_ids": ["unit_ids of child units"],

  "_behaviour": "Behaviour contract — what a re-implementer must preserve:",
  "behavior_summary": "1-2 sentence intent: given X this unit ensures Y. NOT a description of the implementation.",
  "preconditions": ["conditions required on entry"],
  "postconditions": ["conditions guaranteed on normal exit"],
  "invariants": ["properties that hold throughout"],
  "edge_cases": ["distinct input shapes + observed behaviour"],
  "error_policy": {
    "raises": ["exception/error types thrown"],
    "reverts": ["revert reasons for chain code, or []"],
    "on_invalid_input": "string or null",
    "returns_on_error": "string or null"
  },
  "state_mutations": ["storage / globals / args mutated"],
  "events_emitted": ["events / signals fired"],
  "calls": [
    { "name": "string", "source": "string|null", "kind": "internal|external" }
  ],
  "symbol_references": ["external types/constants referenced"],
  "io_format_spec": "exact I/O / serialization / ABI shape, or null",

  "_spec_literals": "Literals that are PART OF the contract (not for reconstruction):",
  "spec_literals": [
    {
      "kind": "regex|sql|cypher|error-message|format-string|enum-value|abi-fragment|magic-number",
      "value": "VERBATIM byte-for-byte",
      "role": "what role this literal plays in the contract (e.g. 'rejection pattern', 'error code surfaced to caller')"
    }
  ],

  "_declared_constants": "Named constants the unit declares as part of its public contract:",
  "declared_constants": [
    { "name": "string|null", "value": "verbatim", "kind": "string" }
  ],

  "_oracle": "Per-unit verification oracle — tests a checker can run:",
  "spec_tests": [
    {
      "test_id": "kebab-case-slug, unique within this unit",
      "scenario": "one-sentence situation under test",
      "given": ["verbatim setup expression(s), or plain-language description"],
      "when": "verbatim call expression, or plain-language action",
      "then": "verbatim observable outcome / assertion",
      "oracle_kind": "unit-test|property|invariant-check|error-path|state-transition|fingerprint",
      "rationale": "one line on which invariant / edge case / error path this test pins. Skip if obvious; else max ~20 words."
    }
  ],

  "_external_tests": "Pointers to existing tests already covering this unit (do NOT invent):",
  "test_references": ["repo-relative path or test id"]
}`;

/** Human-readable field definitions paired with the JSON shape above. */
export const UNIT_IR_FIELDS_BLOCK = `=== Surface contract ===

- signature, parameters, return_type, decorators, modifiers_applied, mutability, visibility,
  is_async, is_generator, is_abstract, is_static, generic_type_params : Verbatim transcription
  of the unit's public surface. A caller in any language MUST be able to bind against these.
- base_types, implements, members, member_unit_ids : For container/type units only. Logic
  fields stay empty.

=== Behaviour contract ===

- behavior_summary  : 1-2 sentences. Intent only — what the unit guarantees, not how. Sign-off
                      anchor for human review.
- preconditions     : What MUST hold on entry. Caller's obligation.
- postconditions    : What MUST hold on normal exit. Unit's obligation.
- invariants        : Properties that hold throughout (ordering, non-null, monotonicity, …).
- edge_cases        : Distinct input shapes + the OBSERVED behaviour for each. Cover empty,
                      oversized, malformed, boundary, and error paths.
- error_policy      : Structured error contract — what is raised/reverted, what is returned on
                      invalid input, what fallback value (if any) is produced.
- state_mutations   : Every storage / global / argument the unit mutates. Empty for pure units.
- events_emitted    : Events / signals / channel writes the unit publishes.
- calls             : External dependencies the unit RELIES on (internal-local / external).
                      A reimplementation may swap providers but must preserve the dependency
                      contract this list defines.
- symbol_references : External types/constants referenced.
- io_format_spec    : Exact I/O / serialization / ABI shape when the unit is at an I/O boundary.

=== Spec literals (contractual literals only) ===

- spec_literals     : Only literals that are PART OF the contract — a regex callers depend on,
                      an error code the unit surfaces, a format string consumers parse, an ABI
                      fragment chain code commits to. \`role\` says why the literal is contractual.
                      Cosmetic literals (log messages, comments) DO NOT belong here.
- declared_constants: Named constants the unit declares as part of its public contract.

=== Per-unit verification oracle ===

- spec_tests        : Up to 8 entries. Each test is a checkable claim about the unit's
                      observable behaviour. Together with the surface and behaviour fields, a
                      checker can prove a reimplementation matches the spec.
    test_id        : stable kebab-case slug ("rejects-empty-input", "preserves-ordering").
    scenario       : one sentence.
    given          : verbatim setup expression(s) or plain-language preconditions.
    when           : verbatim call/action or plain-language trigger.
    then           : verbatim observable outcome / assertion.
    oracle_kind    :
      - unit-test        : concrete input → concrete output assertion.
      - property         : quantified claim ("for any non-empty list, output length == input length").
      - invariant-check  : restates an invariant from \`invariants\` that must hold post-call.
      - error-path       : asserts that a specific invalid input triggers a specific error_policy outcome.
      - state-transition : asserts a specific state_mutations / events_emitted effect.
      - fingerprint      : claim about a deterministic identity / hash / canonical form.
    rationale      : one line on which invariant / edge case / error path is pinned. Skip if obvious.
  Tests describe BEHAVIOUR, not implementation. A reimplementation in a different language
  must be checkable against the same test. If you would have to speculate to write a test,
  add an entry to the file-level \`ambiguities\` instead.

- test_references   : Repo-relative paths or test ids that ALREADY cover this unit. Pointers
                      only; do NOT invent tests here.`;
