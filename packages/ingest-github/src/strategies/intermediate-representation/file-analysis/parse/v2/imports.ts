/**
 * Narrows the reshaped `imports_internal` and `imports_external` arrays into structured
 * {@link InternalImport} / {@link ExternalImport} entries. Pass-1 leaves `resolvedRelativePath`
 * and `resolvedFileId` as null — mcp-enrichment (pass-2) fills them.
 */
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  ExternalImport,
  InternalImport,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/substrate.ts";
import { pickRecordArray } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import { parseSourceAnchor } from "./anchors.ts";

/**
 * Parses the untrusted `imports_internal` array into structured {@link InternalImport} entries.
 *
 * @param value - The untrusted `imports_internal` field.
 * @returns The parsed internal imports (entries without a spec are dropped).
 */
export function parseInternalImports(value: unknown): InternalImport[] {
  const out: InternalImport[] = [];
  for (const rec of pickRecordArray(value)) {
    const spec = pickString(rec["spec"], "");
    if (spec.length === 0) {
      continue;
    }
    out.push({
      spec,
      symbols: pickStringArray(rec["symbols"]),
      anchor: parseSourceAnchor(rec["anchor"]),
      resolvedRelativePath: null,
      resolvedFileId: null,
    });
  }
  return out;
}

/**
 * Parses the untrusted `imports_external` array into structured {@link ExternalImport} entries.
 *
 * @param value - The untrusted `imports_external` field.
 * @returns The parsed external imports (entries without a spec are dropped).
 */
export function parseExternalImports(value: unknown): ExternalImport[] {
  const out: ExternalImport[] = [];
  for (const rec of pickRecordArray(value)) {
    const spec = pickString(rec["spec"], "");
    if (spec.length === 0) {
      continue;
    }
    const pkg = typeof rec["package"] === "string" && rec["package"].length > 0 ? rec["package"] : null;
    out.push({
      spec,
      symbols: pickStringArray(rec["symbols"]),
      package: pkg,
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}
