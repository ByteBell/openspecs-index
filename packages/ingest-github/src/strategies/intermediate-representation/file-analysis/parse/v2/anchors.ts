/**
 * Narrows the snake_case `anchor` sub-object into a {@link SourceAnchor}. Defaults both lines
 * to 0 when missing/invalid so the IR stays total — callers that need a valid range can check.
 */
import type { SourceAnchor } from "#src/strategies/intermediate-representation/file-analysis/types/v2/anchors.ts";
import { asRecord, pickInt } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";

/**
 * Parses one untrusted `anchor` object into a {@link SourceAnchor}.
 *
 * @param value - The untrusted `anchor` field.
 * @returns A total anchor; missing/invalid fields default to 0.
 */
export function parseSourceAnchor(value: unknown): SourceAnchor {
  const rec = asRecord(value) ?? {};
  return {
    startLine: pickInt(rec["start_line"], 0),
    endLine: pickInt(rec["end_line"], 0),
  };
}
