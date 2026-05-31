/**
 * Narrows the reshaped `side_effects` object into a categorized {@link SideEffects} record.
 * Replaces the v1 flat `string[]`. Buckets default to `[]` so the IR stays total.
 */
import { pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type { SideEffects } from "#src/strategies/intermediate-representation/file-analysis/types/v2/shape.ts";
import { asRecord } from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";

/** Empty side-effects shape — every bucket present, every list empty. */
export function emptySideEffects(): SideEffects {
  return { io: [], network: [], env: [], fs: [], process: [], mutationOfArg: [] };
}

/**
 * Parses the untrusted `side_effects` object into a {@link SideEffects} record.
 *
 * @param value - The untrusted `side_effects` field.
 * @returns A total categorized record; missing buckets default to `[]`.
 */
export function parseSideEffects(value: unknown): SideEffects {
  const rec = asRecord(value);
  if (rec === null) {
    return emptySideEffects();
  }
  return {
    io: pickStringArray(rec["io"]),
    network: pickStringArray(rec["network"]),
    env: pickStringArray(rec["env"]),
    fs: pickStringArray(rec["fs"]),
    process: pickStringArray(rec["process"]),
    mutationOfArg: pickStringArray(rec["mutation_of_arg"]),
  };
}
