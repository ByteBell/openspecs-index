import directoryIgnore from "./seed-data/directoryIgnore.json" with { type: "json" };
import filenameIgnore from "./seed-data/filenameIgnore.json" with { type: "json" };
import ignorePatterns from "./seed-data/ignorePatterns.json" with { type: "json" };
import extensions from "./seed-data/extensions.json" with { type: "json" };

interface PatternEntry {
  type: string;
  pattern: string;
}

const allPatterns: PatternEntry[] = Object.values(ignorePatterns as Record<string, PatternEntry[]>).flat();

export const SEED_DIRECTORIES: ReadonlySet<string> = new Set([
  ...(directoryIgnore as string[]),
  ...allPatterns.filter((p) => p.type === "directory").map((p) => p.pattern),
]);

export const SEED_FILENAMES: ReadonlySet<string> = new Set([
  ...(filenameIgnore as string[]),
  ...allPatterns.filter((p) => p.type === "exact").map((p) => p.pattern),
]);

export const SEED_EXTENSIONS: ReadonlySet<string> = new Set(
  allPatterns.filter((p) => p.type === "extension").map((p) => normalizeExt(p.pattern)),
);

export const SEED_GLOBS: readonly string[] = allPatterns.filter((p) => p.type === "glob").map((p) => p.pattern);

export const KNOWN_LANGUAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map(
  Object.entries(extensions as Record<string, string>).map(([ext, lang]) => [normalizeExt(ext), lang]),
);

/** Lowercase an extension and ensure a single leading dot (`png` → `.png`). */
export function normalizeExt(ext: string): string {
  const lower = ext.toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

const GLOB_RE_CACHE = new Map<string, RegExp>();

export function matchesAnyGlob(filename: string, globs: readonly string[] = SEED_GLOBS): boolean {
  for (const glob of globs) {
    let re = GLOB_RE_CACHE.get(glob);
    if (re === undefined) {
      re = compileGlob(glob);
      GLOB_RE_CACHE.set(glob, re);
    }
    if (re.test(filename)) {
      return true;
    }
  }
  return false;
}

function compileGlob(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  const pattern = escaped
    .replace(/\*\*/gu, "::DOUBLESTAR::")
    .replace(/\*/gu, "[^/]*")
    .replace(/::DOUBLESTAR::/gu, ".*");
  return new RegExp(`^${pattern}$`, "u");
}
