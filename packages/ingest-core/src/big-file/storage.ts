import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeMetaPath } from "#src/pipeline/paths.ts";
import type { CondensedFileAnalysis } from "#src/types/condensed-file-analysis.ts";
import type { ChunkAnalysisResult, HugeFileManifest } from "#src/types/big-file.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";

const DIR_MODE = 0o700;

function chunkDir(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.bigFileChunksDir, encodeMetaPath(relativePath));
}

function chunkFile(metaPaths: MetaPaths, relativePath: string, chunkIndex: number): string {
  return path.join(chunkDir(metaPaths, relativePath), `chunk-${chunkIndex}.json`);
}

function manifestFile(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.bigFileAnalysisDir, `${encodeMetaPath(relativePath)}.manifest.json`);
}

function condensedFile(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.fileAnalysisDir, `${encodeMetaPath(relativePath)}.json`);
}

export async function saveChunk(metaPaths: MetaPaths, result: ChunkAnalysisResult): Promise<string> {
  await mkdir(chunkDir(metaPaths, result.relativePath), { recursive: true, mode: DIR_MODE });
  const file = chunkFile(metaPaths, result.relativePath, result.chunkIndex);
  await writeFile(file, JSON.stringify(result, null, 2), "utf8");
  return file;
}

export async function loadChunkIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkIndex: number,
): Promise<ChunkAnalysisResult | null> {
  try {
    const raw = await readFile(chunkFile(metaPaths, relativePath, chunkIndex), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as ChunkAnalysisResult;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveManifest(metaPaths: MetaPaths, manifest: HugeFileManifest): Promise<void> {
  await writeFile(manifestFile(metaPaths, manifest.relativePath), JSON.stringify(manifest, null, 2), "utf8");
}

export async function readManifestIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
): Promise<HugeFileManifest | null> {
  try {
    const raw = await readFile(manifestFile(metaPaths, relativePath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as HugeFileManifest;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveCondensed(metaPaths: MetaPaths, entry: CondensedFileAnalysis): Promise<void> {
  await writeFile(condensedFile(metaPaths, entry.relativePath), JSON.stringify(entry, null, 2), "utf8");
}

export async function readCondensed(metaPaths: MetaPaths, relativePath: string): Promise<CondensedFileAnalysis | null> {
  try {
    const raw = await readFile(condensedFile(metaPaths, relativePath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as CondensedFileAnalysis;
    }
    return null;
  } catch {
    return null;
  }
}

export async function* iterateCondensed(metaPaths: MetaPaths): AsyncGenerator<CondensedFileAnalysis> {
  let entries: string[];
  try {
    entries = await readdir(metaPaths.fileAnalysisDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await readFile(path.join(metaPaths.fileAnalysisDir, name), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        yield parsed as CondensedFileAnalysis;
      }
    } catch {
      continue;
    }
  }
}
