/**
 * The exact JSON shape the IR strategy's file-analysis call must emit. Snake_case keys are the
 * LLM contract; the parser maps them to the camelCase {@link FileAnalysisResult} IR.
 *
 * Field groups:
 * - v1 carryovers (unchanged from flat-folder).
 * - Reshapes (sectionMap, sideEffects, importsInternal/External, contractsProvided/Consumed).
 * - v2 substrate (publicSignatures, typeShapes, localCallGraph, dataFlowGraph, verbatimLiterals,
 *   canonicalCentroid, representationFamily/Type).
 * - Error-aware (edgeCases, boundaryConditions, errorHandling, invariants, diagnosticNotes).
 * - Orchestration (assumptions, ambiguities, concurrencyModel, stateModel).
 * - Shape (fileFingerprint, reconstructionHints).
 *
 * `data_flow_direction` is DROPPED (replaced by `data_flow_graph`).
 */
export const FILE_ANALYSIS_JSON_SHAPE = `Return JSON with EXACTLY these keys:
{
  "language": "string",

  "_comment_v1": "FILE-LEVEL v1 carryover fields (one per file):",
  "purpose": "one sentence: why this file exists",
  "summary": "2-4 sentence intent-focused summary of the whole file",
  "businessContext": "business value of the whole file",
  "classes": ["all class/type names across the file"],
  "functions": ["all top-level function names across the file"],
  "keywords": ["key terms for the whole file"],
  "ontologyConcepts": ["domain concepts"],
  "businessEntities": ["business objects"],
  "systemCapabilities": ["what the file lets the system DO"],
  "configDependencies": ["env vars, config keys, constants relied on"],

  "_comment_reshapes": "Reshaped fields (replacing v1's flat strings):",
  "imports_internal": [
    { "spec": "./path/to/x", "symbols": ["A","B"], "anchor": { "start_line": 1, "end_line": 1 } }
  ],
  "imports_external": [
    { "spec": "lodash", "symbols": ["debounce"], "package": "lodash", "anchor": { "start_line": 1, "end_line": 1 } }
  ],
  "side_effects": {
    "io": ["one-line effect per entry"],
    "network": ["..."],
    "env": ["..."],
    "fs": ["..."],
    "process": ["..."],
    "mutation_of_arg": ["..."]
  },
  "integration_surface": ["channel-prefixed: api_call:..., event_pub:..., event_sub:..., table_read:..., table_write:..., grpc:..., queue:..., shared_schema:..., ws:..."],
  "contracts_provided": [
    { "name": "string", "shape": "verbatim signature or schema fragment" }
  ],
  "contracts_consumed": [
    { "name": "string", "shape": "verbatim signature or schema fragment" }
  ],
  "section_map": [
    {
      "name": "section name",
      "intent": "what this section accomplishes",
      "structure_kind": "sequence|branch|loop|try|async|generator|recursion|io|declaration",
      "predicate": "verbatim guard, or null",
      "branch_outcomes": ["only when structure_kind=branch"],
      "bounds": "verbatim range, or null",
      "termination_condition": "verbatim, or null",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],

  "_comment_substrate": "v2 reconstruction substrate:",
  "representation_family": "module|class-bag|function-bag|state-machine|config|schema|script|test|fixture|barrel|binding|documentation|unknown",
  "representation_type": "free label refining the family",
  "public_signatures": [
    {
      "kind": "function|class|interface|method|...",
      "name": "string",
      "signature": "VERBATIM signature including parameter names, defaults, return type",
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
      "shape": "VERBATIM definition body",
      "discriminant": "field name for unions, else null",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "local_call_graph": [
    {
      "caller": "qualified name",
      "callee": "qualified name",
      "origin": "local|import|this|super|global",
      "kind": "call|construct|await|yield|spawn",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "data_flow_graph": [
    {
      "producer": "qualified name",
      "consumer": "qualified name",
      "payload": "what flows",
      "transformation": "shape change description, or null",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "verbatim_literals": [
    {
      "kind": "regex|sql|cypher|prompt|error-message|format-string|magic-number|env-key|url|header-name|mime-type|shell-command",
      "value": "BYTE-FOR-BYTE COPY from source",
      "context": "what uses it, or null",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "canonical_centroid": {
    "paragraph": "<=200-token paragraph the reconstructor reads by default",
    "token_estimate": 0
  },

  "_comment_error_aware": "Error-aware fields:",
  "edge_cases": [
    { "input_shape": "string", "handled": false, "behavior": "string", "anchor": { "start_line": 0, "end_line": 0 } }
  ],
  "boundary_conditions": [
    {
      "operator": "<|<=|>|>=|==|!=",
      "left": "verbatim",
      "right": "verbatim",
      "inclusive": false,
      "intent": "what this guard expresses",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "error_handling": [
    {
      "thrown": "exception/error type, or null",
      "caught": "exception/error type, or null",
      "action": "what is done on error",
      "fallback": "what is returned, or null",
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
  "diagnostic_notes": [
    {
      "category": "tricky|surprising|bug-magnet|performance|concurrency",
      "description": "one line",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],

  "_comment_orchestration": "Orchestration fields:",
  "assumptions": [
    {
      "kind": "caller|env|config|init-order|platform|schema",
      "description": "one line",
      "anchor": { "start_line": 0, "end_line": 0 }
    }
  ],
  "ambiguities": [
    {
      "question": "what the analyzer is unsure about",
      "affects": "which field/area this gap blocks",
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
        "from": "state name",
        "to": "state name",
        "trigger": "event or call",
        "guard": "verbatim or null",
        "effect": "string or null",
        "anchor": { "start_line": 0, "end_line": 0 }
      }
    ]
  },

  "_comment_shape": "Shape + compression:",
  "file_fingerprint": {
    "line_count": 0,
    "declaration_count": 0,
    "max_nesting_depth": 0,
    "rough_cyclomatic": 0
  },
  "reconstruction_hints": {
    "naming_style": "camelCase|snake_case|PascalCase|kebab-case|mixed|unknown",
    "return_style": "explicit|implicit-last-expr|mixed|n/a",
    "comment_style": "line|block|doc|mixed|none",
    "dialect": "free label, e.g. ts-strict, py-3.11, rs-2021"
  },

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
