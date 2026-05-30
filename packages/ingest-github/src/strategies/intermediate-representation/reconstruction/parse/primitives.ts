/**
 * Low-level narrowing primitives for the reconstruction parsers. LLM JSON is untrusted, so
 * every scalar and container is narrowed here before any IR parser touches it. The string
 * helpers (`pickString`, `pickStringArray`) are reused from the parent IR `parse.ts`.
 */

/**
 * Narrows an untrusted value to a plain object, or null when it is not one.
 *
 * @param value - The untrusted candidate.
 * @returns The value as a record, or `null`.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Narrows an untrusted value to a boolean, falling back when it is not one.
 *
 * @param value - The untrusted candidate.
 * @param fallback - Returned when `value` is not a boolean (default `false`).
 * @returns A guaranteed boolean.
 */
export function pickBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Narrows an untrusted value to a finite integer, flooring and falling back as needed.
 *
 * @param value - The untrusted candidate.
 * @param fallback - Returned when `value` is not a finite number (default `0`).
 * @returns A guaranteed integer.
 */
export function pickInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
}

/**
 * Narrows an untrusted value to a finite number, falling back as needed.
 *
 * @param value - The untrusted candidate.
 * @param fallback - Returned when `value` is not a finite number (default `0`).
 * @returns A guaranteed finite number.
 */
export function pickNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Narrows an untrusted value to a number clamped to the inclusive `[0, 1]` range.
 *
 * @param value - The untrusted candidate (e.g. a completeness score).
 * @returns A number in `[0, 1]`; `0` when the input is not a finite number.
 */
export function clamp01(value: unknown): number {
  const n = pickNumber(value, 0);
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

/**
 * Narrows an untrusted value to an array of plain-object records, dropping non-objects.
 *
 * @param value - The untrusted candidate (expected to be an array).
 * @returns A new array of records (possibly empty).
 */
export function pickRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (rec !== null) {
      out.push(rec);
    }
  }
  return out;
}
