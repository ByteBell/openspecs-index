import { passesPathFilters } from "@bb/ingest-core";
import { matchesAnyGlob } from "@bb/ingest-core";
import type { EffectiveIgnoreSets } from "@bb/ingest-core";
import type { BigFileEntry } from "@bb/ingest-core";

/**
 * Replicates the index-time static skip decision for a single diff path:
 * filename + extension + directory segments + globs, all against the per-job
 * effective ignore sets — so a pull rejects exactly what the initial index
 * rejected. `sets` is REQUIRED: a caller with no overrides passes
 * `buildEffectiveIgnoreSets()` (pure seed defaults). There is deliberately no
 * undefined fallback — a fallback would silently skip the directory and glob
 * checks and reintroduce the index-vs-pull divergence this function exists to
 * close.
 */
export function isStaticallyIgnored(
  relativePath: string,
  filename: string,
  ext: string,
  sets: EffectiveIgnoreSets,
): boolean {
  if (!passesPathFilters(filename, ext, sets)) {
    return true;
  }
  for (const segment of relativePath.split("/").slice(0, -1)) {
    if (sets.directories.has(segment)) {
      return true;
    }
  }
  return matchesAnyGlob(filename, sets.globs);
}

/** Merge big-file entries by path, later additions winning. */
export function mergeBigFileEntries(existing: BigFileEntry[], additions: BigFileEntry[]): BigFileEntry[] {
  const byPath = new Map<string, BigFileEntry>();
  for (const entry of existing) {
    byPath.set(entry.relativePath, entry);
  }
  for (const entry of additions) {
    byPath.set(entry.relativePath, entry);
  }
  return [...byPath.values()];
}

export function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
