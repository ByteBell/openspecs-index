import path from "node:path";
import { ROOT_FOLDER_PLACEHOLDER, encodeMetaPath } from "./encode.ts";
import type { MetaPaths } from "./types.ts";

/** `<fileAnalysisDir>/<encoded>.json` — the per-file analysis record (small, condensed, or IR). */
export function fileAnalysisFile(meta: MetaPaths, relativePath: string): string {
  return path.join(meta.fileAnalysisDir, `${encodeMetaPath(relativePath)}.json`);
}

/** `<bigFileChunksDir>/<encoded>/` — directory holding one big file's chunk JSONs. */
export function bigFileChunkDir(meta: MetaPaths, relativePath: string): string {
  return path.join(meta.bigFileChunksDir, encodeMetaPath(relativePath));
}

/** `<bigFileChunkDir>/chunk-<index>.json`. */
export function bigFileChunk(meta: MetaPaths, relativePath: string, chunkIndex: number): string {
  return path.join(bigFileChunkDir(meta, relativePath), `chunk-${chunkIndex}.json`);
}

/** `<bigFileAnalysisDir>/<encoded>.manifest.json`. */
export function bigFileManifest(meta: MetaPaths, relativePath: string): string {
  return path.join(meta.bigFileAnalysisDir, `${encodeMetaPath(relativePath)}.manifest.json`);
}

/** `<folderSummariesDir>/<encoded-or-__ROOT__>.json`. */
export function folderSummaryFile(meta: MetaPaths, folderPath: string): string {
  return path.join(meta.folderSummariesDir, `${encodeMetaPath(folderPath || ROOT_FOLDER_PLACEHOLDER)}.json`);
}

/** `<codeUnitsDir>/<encoded>.json` — IR-extracted code units for one source file. */
export function codeUnitsFile(meta: MetaPaths, relativePath: string): string {
  return path.join(meta.codeUnitsDir, `${encodeMetaPath(relativePath)}.json`);
}
