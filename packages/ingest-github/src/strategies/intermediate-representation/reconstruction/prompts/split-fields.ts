/**
 * The exact JSON shape Prompt 1 (file splitter / unit discovery) must emit. Snake_case keys
 * are the LLM contract; the parser maps them to the camelCase {@link FileAnalysisResult} IR. Plain
 * string constant — no per-symbol docstring.
 */
export const SPLIT_JSON_SHAPE = `Return JSON with EXACTLY these keys:
{
  "language": "string",

  "_comment": "FILE-LEVEL analysis (one per file — describes the WHOLE file):",
  "purpose": "one sentence: why this file exists",
  "summary": "2-4 sentence intent-focused summary of the whole file",
  "businessContext": "business value of the whole file",
  "classes": ["all class/type names across the file"],
  "functions": ["all top-level function names across the file"],
  "importsInternal": ["union of internal imports"],
  "importsExternal": ["union of external imports"],
  "keywords": ["key terms for the whole file"],
  "ontologyConcepts": ["domain concepts"],
  "businessEntities": ["business objects"],
  "systemCapabilities": ["what the file lets the system DO"],
  "sideEffects": ["files written, network calls, global state, ..."],
  "configDependencies": ["env vars, config keys, constants relied on"],
  "dataFlowDirection": "input-output | request-response | internal | ...",
  "integrationSurface": ["CLI entry, HTTP route, event handler, ..."],
  "contractsProvided": ["public API the file exposes"],
  "contractsConsumed": ["external API the file depends on"],
  "sectionMap": [{ "name": "section name", "description": "what it does" }],

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
      "unit_kind": "open vocabulary, language-accurate (function|method|class|struct|enum|trait|impl|interface|contract|library|modifier|event|module|macro|type_alias|...)",
      "name": "string",
      "qualified_name": "parent-qualified name",
      "parent_unit_id": "container unit_id, or null",
      "start_line": 0,
      "end_line": 0,
      "is_behavioral": false,
      "source": "VERBATIM source of just this unit, unmodified"
    }
  ]
}`;
