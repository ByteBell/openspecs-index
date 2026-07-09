import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { metaId } from "#src/pipeline/paths.ts";
import type { ScanManifest } from "#src/scan-manifest.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";

/**
 * Persisted inverse of the `metaId` storage-key scheme (see pipeline/paths.ts). Every meta-output artifact
 * dir is named `metaId(<repo-relative path>)` — a one-way hash — so this `<metaOutputRoot>/path-map.json`
 * records `id → path` for every file and every ancestor folder. Two roles:
 *   1. External consumers (the VS Code extension) rebuild the repo's folder tree from it, then fetch each
 *      artifact by recomputing `metaId(path)`.
 *   2. Its PRESENCE marks a metaRoot as written by the hash scheme ("v2"), which the incremental baseline
 *      gate uses to refuse seeding a new run from an old `__SL__`-encoded tree.
 * Built ONCE from the scan manifest (all paths known before any fan-out worker starts), so no concurrency.
 */
export const PATH_MAP_RELATIVE_PATH = "path-map.json";
export const PATH_MAP_SCHEMA_VERSION = 1;

export interface PathMap {
  version: number;
  algo: "sha256";
  /** `metaId(relativePath) → relativePath` for every scanned file. */
  files: Record<string, string>;
  /** `metaId(folderPath) → folderPath` for every ancestor folder; the repo root is `"__ROOT__" → ""`. */
  folders: Record<string, string>;
}

/** PURE. Builds the `id → path` map for every file in the manifest plus every ancestor folder. */
export function buildPathMap(manifest: ScanManifest): PathMap {
  const files: Record<string, string> = {};
  const folders: Record<string, string> = { __ROOT__: "" };
  for (const entry of manifest.entries) {
    files[metaId(entry.relativePath)] = entry.relativePath;
    const parts = entry.relativePath.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const folder = parts.slice(0, i).join("/");
      folders[metaId(folder)] = folder;
    }
  }
  return { version: PATH_MAP_SCHEMA_VERSION, algo: "sha256", files, folders };
}

export function pathMapPath(metaPaths: MetaPaths): string {
  return path.join(metaPaths.metaOutputRoot, PATH_MAP_RELATIVE_PATH);
}

export async function writePathMap(metaPaths: MetaPaths, map: PathMap): Promise<void> {
  await writeFile(pathMapPath(metaPaths), JSON.stringify(map, null, 2), "utf8");
}

export async function readPathMap(metaPaths: MetaPaths): Promise<PathMap | null> {
  try {
    return JSON.parse(await readFile(pathMapPath(metaPaths), "utf8")) as PathMap;
  } catch {
    return null;
  }
}
