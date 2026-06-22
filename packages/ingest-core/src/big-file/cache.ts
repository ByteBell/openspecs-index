import { readManifestIfPresent, readCondensed } from "./storage.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";

export type BigFileCacheStatus = "complete" | "stale-condensed" | "missing";

export async function inspect(metaPaths: MetaPaths, relativePath: string): Promise<BigFileCacheStatus> {
  const manifest = await readManifestIfPresent(metaPaths, relativePath);
  const condensed = await readCondensed(metaPaths, relativePath);
  if (manifest !== null && condensed !== null) {
    if (condensed.totalChunks === manifest.totalChunks && condensed.isBigFile) {
      return "complete";
    }
    return "stale-condensed";
  }
  if (manifest !== null && condensed === null) {
    return "stale-condensed";
  }
  return "missing";
}
