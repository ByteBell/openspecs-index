/**
 * The IR strategy's field-definition block — forked from flat-folder's
 * `FILE_ANALYSIS_FIELDS_BLOCK` and extended with the v2 reconstruction substrate, error-aware,
 * orchestration, shape, and reshape fields. Flat-folder's block is UNCHANGED; the IR strategy
 * references this v2 block from its system prompt.
 *
 * Snake_case keys here mirror the JSON shape declared in `file-analysis-fields.ts`.
 */
export const FILE_ANALYSIS_FIELDS_BLOCK_V2 = `=== v1 carryover fields (unchanged from flat-folder) ===

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

=== Reshaped fields (replacing v1's flat strings) ===

- imports_internal    : Array<{spec, symbols[], anchor}> — One entry per RELATIVE import statement. \`spec\` is the verbatim path as written (./x, ../y, etc.). \`symbols\` lists the named bindings brought in (default import name included). \`anchor\` is the import statement's line span. Do NOT include resolvedRelativePath / resolvedFileId — pass-2 fills those.
- imports_external    : Array<{spec, symbols[], package?, anchor}> — One entry per third-party/stdlib import. \`spec\` = verbatim source; \`package\` = the npm/PyPI/crates name when distinct from spec. \`symbols\` = named bindings.
- side_effects        : {io, network, env, fs, process, mutation_of_arg} — Each bucket is a list of one-line observable effects in that category. Categorize precisely; an HTTP call goes under \`network\`, a file write under \`fs\`, a console.log under \`io\`. Empty arrays for buckets with no effects.
- integration_surface : string[] — External systems the file touches, EACH ENTRY PREFIXED with the channel kind: \`api_call:\`, \`event_pub:\`, \`event_sub:\`, \`table_read:\`, \`table_write:\`, \`grpc:\`, \`queue:\`, \`shared_schema:\`, \`ws:\`, or \`fs:\`. Example: "api_call:openrouter /chat/completions".
- contracts_provided  : Array<{name, shape}> — Public exports / endpoints / interfaces. \`name\` = the exact identifier; \`shape\` = the verbatim signature, route, or schema fragment. Do not include resolution fields — pass-2 fills those.
- contracts_consumed  : Array<{name, shape}> — Public exports / endpoints / interfaces this file depends on. Same shape as contracts_provided.
- section_map         : Array<SectionMapEntry> — Major sections of the file. Each entry has:
    name                   : section identifier (e.g. "validate input", "fetch loop")
    intent                 : what this section ACCOMPLISHES (NOT what it looks like; max ~15 words)
    structure_kind         : one of sequence | branch | loop | try | async | generator | recursion | io | declaration
    predicate              : verbatim guard expression when structure_kind=branch|loop, else null
    branch_outcomes        : ordered branch labels when structure_kind=branch, else []
    bounds                 : verbatim iteration bound when structure_kind=loop, else null
    termination_condition  : verbatim termination expression when structure_kind=loop|recursion, else null
    anchor                 : line span of the section
  Up to 8 entries. NO free-prose "description" field — describe via intent + structure_kind.

=== v2 reconstruction substrate ===

- representation_family : closed enum — module | class-bag | function-bag | state-machine | config | schema | script | test | fixture | barrel | binding | documentation | unknown. Pick the BEST match.
- representation_type   : free label — refines the family (e.g. "express-route", "react-hook", "zod-schema", "redux-slice"). Empty string if no useful label.
- public_signatures     : Array<{kind, name, signature, generics, decorators, return_type, exported, anchor}> — Every exported (and every locally-relevant) declaration's VERBATIM signature: parameter names, defaults, return type, generics, decorators. Preserve whitespace inside the signature string.
- type_shapes           : Array<{kind, name, shape, discriminant, anchor}> — Every interface/type/enum/union with its EXACT body in \`shape\` (verbatim). For tagged unions set \`discriminant\` to the discriminating field name.
- local_call_graph      : Array<{caller, callee, origin, kind, anchor}> — Every within-file call edge. \`origin\` distinguishes locally-defined targets from imported / this / super / global. \`kind\` distinguishes call from construct/await/yield/spawn.
- data_flow_graph       : Array<{producer, consumer, payload, transformation, anchor}> — Within-file producer→consumer edges. \`payload\` describes WHAT flows (a value, a stream, a promise); \`transformation\` notes any shape change.
- verbatim_literals     : Array<{kind, value, context, anchor}> — Every literal that must be preserved BYTE-FOR-BYTE: regex, sql, cypher, prompt, error-message, format-string, magic-number, env-key, url, header-name, mime-type, shell-command. Copy \`value\` exactly as it appears in source (including quotes, escapes, whitespace). \`context\` notes what uses it.
- canonical_centroid    : {paragraph, token_estimate} — A single ≤200-token paragraph the reconstructor reads to regenerate the file. Distill the file's identity: representation, contracts, side effects, key constants, key flow. \`token_estimate\` is your rough estimate of the paragraph's token count.

=== Error-aware fields ===

- edge_cases          : Array<{input_shape, handled, behavior, anchor}> — Distinct input shapes (empty, oversized, malformed, boundary), whether the code handles each, and what it does. Anchor to the handling code (or the missing handler's location).
- boundary_conditions : Array<{operator, left, right, inclusive, intent, anchor}> — EVERY \`<\`, \`<=\`, \`>\`, \`>=\`, \`==\`, \`!=\` in the file. \`inclusive\` makes the \`<=\` vs \`<\` distinction explicit; \`intent\` says what the guard expresses in natural language ("must have at least one item", "stop before EOF"). One entry per occurrence.
- error_handling      : Array<{thrown, caught, action, fallback, anchor}> — Each error path: what is thrown OR caught (one of them set), what action is taken (log / rethrow / wrap), and what fallback value/path is returned. Anchor to the throw/catch site.
- invariants          : Array<{kind, description, anchor}> — Pre/post-conditions, non-null promises, ordering invariants the code relies on. One-line descriptions; anchor to the relevant block.
- diagnostic_notes    : Array<{category, description, anchor}> — Tricky / surprising / bug-magnet / performance / concurrency passages the analyzer wants to flag for future readers. One-line descriptions.

=== Orchestration fields ===

- assumptions         : Array<{kind, description, anchor}> — Non-obvious assumptions the file rests on. \`kind\` ∈ caller | env | config | init-order | platform | schema. Example: caller-must-await, env-NODE_ENV-set, called-after-init.
- ambiguities         : Array<{question, affects, anchor}> — TBDs the analyzer is UNSURE about and cannot resolve from this file alone. \`affects\` names the field/area this gap blocks. Pass-2 clears these by reading other files.
- concurrency_model   : {kind, reentrant, ordering, notes} — \`kind\` ∈ sync | async | streaming | event | generator | mixed. \`reentrant\` = safe to call again before the previous completes. \`ordering\` ∈ fifo | lifo | unordered | deterministic | non-deterministic | unknown.
- state_model         : {states[], initial_state, final_states[], transitions[]} OR null — Populate ONLY when representation_family = "state-machine". Each transition: {from, to, trigger, guard?, effect?, anchor}. Else set to null.

=== Shape + compression ===

- file_fingerprint     : {line_count, declaration_count, max_nesting_depth, rough_cyclomatic} — Quantitative shape. Counts are integers; \`rough_cyclomatic\` is your best estimate.
- reconstruction_hints : {naming_style, return_style, comment_style, dialect} — Stylistic surface so the regenerator matches the original. \`naming_style\` ∈ camelCase | snake_case | PascalCase | kebab-case | mixed | unknown. \`return_style\` ∈ explicit | implicit-last-expr | mixed | n/a. \`comment_style\` ∈ line | block | doc | mixed | none. \`dialect\` = free label (e.g. ts-strict, py-3.11, rs-2021).

=== Anchor convention ===

Every \`anchor\` is { "start_line": <int>, "end_line": <int> } with INCLUSIVE 1-based line numbers in the source. For a single-line fact set start_line === end_line.

=== Field that was REMOVED in v2 ===

- data_flow_direction : (removed) — Use \`data_flow_graph\` instead (within-file producer→consumer edges with payload).`;
