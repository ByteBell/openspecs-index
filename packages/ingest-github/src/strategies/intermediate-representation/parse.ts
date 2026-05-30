/**
 * Defensive parsers and token-usage helpers shared across the IR modules. LLM JSON is untrusted,
 * so every field is narrowed before use.
 */
import type { OutlineDeclaration, SkimWindowOutline } from "./types.ts";
import { FALLBACK_LANGUAGE } from "#src/types/file-analysis.ts";

/** Token + cost accounting for a single LLM call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** The additive identity for {@link addUsage}. */
export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/**
 * Sums two token-usage records field by field.
 *
 * @param a - First usage record.
 * @param b - Second usage record.
 * @returns A new record holding the per-field sums.
 */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

/**
 * Returns `value` when it is a non-empty string, otherwise `fallback`.
 *
 * @param value - The untrusted candidate.
 * @param fallback - The value to use when `value` is not a non-empty string.
 * @returns A guaranteed string.
 */
export function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Narrows an untrusted value to an array of non-empty strings, dropping anything else.
 *
 * @param value - The untrusted candidate (expected to be an array).
 * @returns A new array containing only the non-empty string entries.
 */
export function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Parses the `declarations` array of a skim response into {@link OutlineDeclaration} entries,
 * skipping items that carry neither a name nor a signature.
 *
 * @param value - The untrusted `declarations` field from the skim JSON.
 * @returns The parsed declarations (possibly empty).
 */
export function parseDeclarations(value: unknown): OutlineDeclaration[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: OutlineDeclaration[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const name = pickString(rec["name"], "");
    const signature = pickString(rec["signature"], "");
    if (name.length === 0 && signature.length === 0) {
      continue;
    }
    out.push({
      kind: pickString(rec["kind"], "other"),
      name,
      signature,
      role: pickString(rec["role"], ""),
    });
  }
  return out;
}

/**
 * Shapes a raw skim JSON object into a {@link SkimWindowOutline}, stamping the window's known
 * line range (which the model is not trusted to report).
 *
 * @param raw - The parsed skim JSON object.
 * @param startLine - The window's first line in the original file (1-based).
 * @param endLine - The window's last line in the original file (1-based).
 * @returns A fully-narrowed window outline.
 */
export function parseSkimOutline(raw: Record<string, unknown>, startLine: number, endLine: number): SkimWindowOutline {
  return {
    startLine,
    endLine,
    language: pickString(raw["language"], FALLBACK_LANGUAGE),
    windowSummary: pickString(raw["windowSummary"], ""),
    importsInternal: pickStringArray(raw["importsInternal"]),
    importsExternal: pickStringArray(raw["importsExternal"]),
    declarations: parseDeclarations(raw["declarations"]),
  };
}
