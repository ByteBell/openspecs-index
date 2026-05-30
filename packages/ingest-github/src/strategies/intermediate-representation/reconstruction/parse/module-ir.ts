/**
 * Parser for the module-level object of a Prompt 1 response into a {@link ModuleIr}.
 * `semanticFingerprint` is left empty here and computed in code once the file is finalised.
 */
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import { FALLBACK_LANGUAGE } from "#src/types/file-analysis.ts";
import type {
  ImportSymbol,
  ModuleIr,
} from "#src/strategies/intermediate-representation/reconstruction/types/module-ir.ts";
import type { SemanticFields } from "#src/strategies/intermediate-representation/reconstruction/types/semantics.ts";
import { asRecord, pickRecordArray } from "./primitives.ts";
import { parseNamedConstants } from "./named-constants.ts";

/**
 * Parses the `import_symbol_map` array into {@link ImportSymbol} entries.
 *
 * @param value - The untrusted `import_symbol_map` field.
 * @returns The parsed import symbols (entries without a symbol are dropped).
 */
function parseImportSymbols(value: unknown): ImportSymbol[] {
  const out: ImportSymbol[] = [];
  for (const rec of pickRecordArray(value)) {
    const symbol = pickString(rec["symbol"], "");
    if (symbol.length === 0) {
      continue;
    }
    const alias =
      typeof rec["alias"] === "string" && (rec["alias"] as string).length > 0 ? (rec["alias"] as string) : null;
    out.push({
      symbol,
      module: pickString(rec["module"], ""),
      alias,
      kind: rec["kind"] === "external" ? "external" : "internal",
    });
  }
  return out;
}

/**
 * Parses the `module` object of a Prompt 1 response into a {@link ModuleIr}, merging in the
 * already-narrowed file-level semantic fields.
 *
 * @param value - The untrusted `module` object.
 * @param language - The file language resolved at the top level of the split response.
 * @param semantic - The file-level flat-folder analysis fields (from `normalizeAnalysisFields`).
 * @returns A fully-narrowed module IR with `semanticFingerprint === ""`.
 */
export function parseModuleIr(value: unknown, language: string, semantic: SemanticFields): ModuleIr {
  const rec = asRecord(value) ?? {};
  const moduleLevelCode =
    typeof rec["module_level_code"] === "string" && (rec["module_level_code"] as string).length > 0
      ? (rec["module_level_code"] as string)
      : null;
  return {
    ...semantic,
    language: pickString(language, FALLBACK_LANGUAGE),
    moduleLayout: pickStringArray(rec["module_layout"]),
    moduleLevelCode,
    exports: pickStringArray(rec["exports"]),
    importSymbolMap: parseImportSymbols(rec["import_symbol_map"]),
    fileConstants: parseNamedConstants(rec["file_constants"]),
    semanticFingerprint: "",
  };
}
