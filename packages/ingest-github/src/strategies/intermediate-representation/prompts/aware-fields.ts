/**
 * JSON shapes for the intermediate-representation (IR) big-file path.
 *
 * Every shape here is a FLAT camelCase object that matches exactly what
 * `shapeAnalysis` (adapters/llm-file-analyzer.ts) reads, so the IR path
 * populates each `FileAnalysis` field through the existing shaper. (The legacy
 * flat-folder prompts ask for snake_case nested keys the shaper never reads.)
 *
 * These are plain string constants, not functions — no docstrings per symbol.
 */

export const AWARE_ANALYSIS_RULES = `Rules:
- Output ONLY the JSON object. No prose, no markdown fences, no commentary.
- Be faithful to the code as written. Do NOT invent behavior the code does not have.
- Keep summaries short and intent-focused.
- Use the supplied FILE MAP to resolve calls and imports defined in other chunks, and to
  describe this chunk in the context of the WHOLE file.`;

/**
 * Per-chunk deep analysis shape. File-level fields (purpose/summary/imports/...) are later
 * overwritten from the file map so they are identical across chunks; classes, functions,
 * sectionMap and dataFlowDirection stay chunk-local.
 */
export const AWARE_DEEP_JSON_SHAPE = `Emit JSON with EXACTLY this flat shape (camelCase keys):
{
  "language": "string",
  "purpose": "one sentence: why this file exists",
  "summary": "2-4 sentences on what THIS chunk contributes to the file",
  "businessContext": "business value this chunk serves",
  "classes": ["class names DEFINED in this chunk"],
  "functions": ["function/method names DEFINED in this chunk"],
  "importsInternal": ["internal module paths used in this chunk"],
  "importsExternal": ["external packages used in this chunk"],
  "keywords": ["key terms for this chunk"],
  "ontologyConcepts": ["domain concepts"],
  "businessEntities": ["business objects"],
  "systemCapabilities": ["what this chunk lets the system DO"],
  "sideEffects": ["files written, network calls, global state, ..."],
  "configDependencies": ["env vars, config keys, constants relied on"],
  "dataFlowDirection": "input-output | request-response | internal | ...",
  "integrationSurface": ["CLI entry, HTTP route, event handler, ..."],
  "contractsProvided": ["public API this chunk exposes"],
  "contractsConsumed": ["external API this chunk depends on"],
  "sectionMap": [{ "name": "section name", "description": "what it does" }]
}`;

/**
 * Thin per-window skim shape. `signature` is the VERBATIM first line of each declaration; it
 * is used to locate the declaration in the source, so it must be copied exactly.
 */
export const SKIM_JSON_SHAPE = `Emit JSON with EXACTLY this flat shape (camelCase keys):
{
  "language": "string",
  "windowSummary": "one line: what this region of the file does",
  "importsInternal": ["internal module paths in this region"],
  "importsExternal": ["external packages in this region"],
  "declarations": [
    {
      "kind": "function | class | method | interface | type | const | enum | other",
      "name": "string",
      "signature": "the VERBATIM first line of the declaration, copied exactly",
      "role": "one line: what this declaration is for"
    }
  ]
}`;
