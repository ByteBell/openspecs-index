import type { IgnoreOverridePatch, IgnoreOverrides } from "@bb/types";
import { BINARY_EXTENSIONS, SKIP_DIRS, SKIP_FILES } from "#src/pipeline/filters.ts";
import { SEED_GLOBS, normalizeExt } from "./seed.ts";

/**
 * The four ignore sets a single ingest job filters against, after overlaying
 * any per-job overrides onto the built-in seed defaults. Built once per job and
 * shared by the directory-walk pruning (`scan.ts`) and the static skip decision
 * (`decider.ts`) so both filter against the identical effective set.
 *
 * `directories`, `filenames`, and `extensions` extend the legacy-merged unions
 * exported by `filters.ts` (which already fold in the seed lists). `globs` is
 * the raw seed glob list, overlaid the same way.
 */
export interface EffectiveIgnoreSets {
  directories: ReadonlySet<string>;
  filenames: ReadonlySet<string>;
  extensions: ReadonlySet<string>;
  globs: readonly string[];
}

function applyPatch(
  base: ReadonlySet<string>,
  patch: IgnoreOverridePatch | undefined,
  transform: (value: string) => string = (value): string => value,
): ReadonlySet<string> {
  if (patch === undefined || (patch.add === undefined && patch.remove === undefined)) {
    return base;
  }
  const next = new Set(base);
  for (const value of patch.add ?? []) {
    next.add(transform(value));
  }
  for (const value of patch.remove ?? []) {
    next.delete(transform(value));
  }
  return next;
}

/** Glob removals match the seed pattern string verbatim (not glob-evaluated). */
function applyGlobPatch(base: readonly string[], patch: IgnoreOverridePatch | undefined): readonly string[] {
  if (patch === undefined || (patch.add === undefined && patch.remove === undefined)) {
    return base;
  }
  const removeSet = new Set(patch.remove ?? []);
  const kept = base.filter((glob) => !removeSet.has(glob));
  return [...kept, ...(patch.add ?? [])];
}

/**
 * Overlay per-job ignore overrides onto the built-in seed defaults. With no
 * overrides this returns the seed/legacy unions unchanged — behavior identical
 * to the pre-override pipeline.
 */
export function buildEffectiveIgnoreSets(overrides?: IgnoreOverrides): EffectiveIgnoreSets {
  return {
    directories: applyPatch(SKIP_DIRS, overrides?.directories),
    filenames: applyPatch(SKIP_FILES, overrides?.filenames),
    extensions: applyPatch(BINARY_EXTENSIONS, overrides?.extensions, normalizeExt),
    globs: applyGlobPatch(SEED_GLOBS, overrides?.globs),
  };
}

/**
 * The built-in ignore defaults as plain, sorted, serializable arrays. Consumed
 * by the enterprise ignore-manager so a UI can display the defaults alongside an
 * org's overrides and let a user un-ignore any of them.
 */
export function defaultIgnorePatternLists(): {
  directories: string[];
  filenames: string[];
  extensions: string[];
  globs: string[];
} {
  return {
    directories: [...SKIP_DIRS].sort(),
    filenames: [...SKIP_FILES].sort(),
    extensions: [...BINARY_EXTENSIONS].sort(),
    globs: [...SEED_GLOBS].sort(),
  };
}
