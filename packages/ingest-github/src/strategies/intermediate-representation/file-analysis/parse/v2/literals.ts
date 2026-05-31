/**
 * Narrows the `verbatim_literals` array into {@link VerbatimLiteral} entries. The `value` is a
 * byte-for-byte copy from source — keep it as-is (do NOT normalise whitespace or quotes).
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  VerbatimLiteral,
  VerbatimLiteralKind,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/substrate.ts";
import { pickRecordArray } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import { parseSourceAnchor } from "./anchors.ts";

const LITERAL_KINDS: ReadonlySet<VerbatimLiteralKind> = new Set([
  "regex",
  "sql",
  "cypher",
  "prompt",
  "error-message",
  "format-string",
  "magic-number",
  "env-key",
  "url",
  "header-name",
  "mime-type",
  "shell-command",
]);

/**
 * Parses the untrusted `verbatim_literals` array into {@link VerbatimLiteral}s.
 *
 * @param value - The untrusted `verbatim_literals` field.
 * @returns The parsed literals (entries with empty value are dropped).
 */
export function parseVerbatimLiterals(value: unknown): VerbatimLiteral[] {
  const out: VerbatimLiteral[] = [];
  for (const rec of pickRecordArray(value)) {
    const literalValue = pickString(rec["value"], "");
    if (literalValue.length === 0) {
      continue;
    }
    const kindRaw = pickString(rec["kind"], "magic-number");
    const kind: VerbatimLiteralKind = LITERAL_KINDS.has(kindRaw as VerbatimLiteralKind)
      ? (kindRaw as VerbatimLiteralKind)
      : "magic-number";
    const context =
      typeof rec["context"] === "string" && (rec["context"] as string).length > 0
        ? (rec["context"] as string)
        : null;
    out.push({
      kind,
      value: literalValue,
      context,
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}
