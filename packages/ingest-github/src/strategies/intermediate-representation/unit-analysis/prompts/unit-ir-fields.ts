/**
 * The exact JSON shape Prompt 2 (unit IR extractor) must emit for ONE code unit. Snake_case
 * keys are the LLM contract; the parser maps them to the camelCase {@link CodeUnit} IR.
 * Fields are adaptive — the model sets null/[]/{} for anything that does not apply to the
 * unit kind. Plain string constant — no per-symbol docstring.
 */
export const UNIT_IR_JSON_SHAPE = `Return JSON with EXACTLY these keys (set null/[]/{} when N/A):
{
  "unit_id": "string", "unit_kind": "string", "name": "string", "qualified_name": "string",
  "parent_unit_id": "string|null",
  "signature": "exact signature verbatim, or null",
  "parameters": [
    { "name": "string", "type": "string|null", "default": "string|null",
      "optional": false, "variadic": false, "order": 0 }
  ],
  "return_type": "string|null",
  "decorators": ["@decorator / #[attr] / annotation"],
  "modifiers_applied": ["applied modifiers, e.g. onlyOwner"],
  "mutability": "pure|view|payable|nonpayable|mut|const|null",
  "visibility": "public|private|external|internal|protected|pub|null",
  "is_async": false, "is_generator": false, "is_abstract": false, "is_static": false,
  "generic_type_params": ["type/template/lifetime params"],
  "logic_outline": [
    { "step": "sequence|branch|loop|return|raise|call|emit",
      "desc": "string", "condition": "string|null", "children": [] }
  ],
  "preconditions": ["string"], "postconditions": ["string"], "invariants": ["string"],
  "edge_cases": ["string"], "tie_breaking_rules": ["string"],
  "error_policy": { "raises": ["string"], "reverts": ["string"],
                    "on_invalid_input": "string|null", "returns_on_error": "string|null" },
  "state_mutations": ["storage/globals/args mutated"], "events_emitted": ["events"],
  "complexity": "target time/space (+gas for Solidity), or null",
  "calls": [ { "name": "string", "source": "string|null", "kind": "internal|external" } ],
  "symbol_references": ["external types/constants referenced"],
  "base_types": ["superclasses / inherited contracts / base structs"],
  "implements": ["interfaces / traits / protocols implemented"],
  "members": [
    { "name": "string", "kind": "string", "type": "string|null", "default": "string|null",
      "visibility": "string|null", "static": false }
  ],
  "member_unit_ids": ["unit_ids of child units"],
  "constants": [ { "name": "string|null", "value": "verbatim", "kind": "string" } ],
  "io_format_spec": "exact I/O / serialization / ABI shape, or null",
  "verbatim_blocks": [ { "kind": "string", "text": "verbatim text" } ],
  "example_io_pairs": [ { "input": "string", "expected_output": "string", "note": "string|null" } ],
  "test_references": ["existing tests usable as oracle"]
}`;
