/**
 * Disk I/O for the IR strategy's persisted records. Every path is resolved against the existing
 * {@link MetaPaths} (shared with flat-folder); per-file names are encoded with `encodeMetaPath`
 * so slashes survive a flat filesystem layout. Big-file chunks live in their own per-file
 * directory; they are NOT rolled up into a per-file manifest — each chunk stands on its own as
 * `chunk-1.json`, `chunk-2.json`, … (1-indexed, matching how a human reads "chunk 1, chunk 2").
 *
 * One record shape — {@link IrFileAnalysisRecord} — is used for BOTH small files and big-file
 * chunks. Chunks share their parent file's `relativePath`; the chunk number lives only in the
 * filename.
 */
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeMetaPath } from "#src/pipeline/paths.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type {
  IrBigFileBoundaries,
  IrBigFileChunkRaw,
  IrFileAnalysisRecord,
} from "./records.ts";

const DIR_MODE = 0o700;

function smallFileFile(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.fileAnalysisDir, `${encodeMetaPath(relativePath)}.json`);
}

function boundariesFile(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.bigFileAnalysisDir, `${encodeMetaPath(relativePath)}.boundaries.json`);
}

function chunkDir(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.bigFileChunksDir, encodeMetaPath(relativePath));
}

function rawChunkFile(metaPaths: MetaPaths, relativePath: string, chunkNumber: number): string {
  return path.join(chunkDir(metaPaths, relativePath), `chunk-${chunkNumber}.raw.json`);
}

function analysedChunkFile(metaPaths: MetaPaths, relativePath: string, chunkNumber: number): string {
  return path.join(chunkDir(metaPaths, relativePath), `chunk-${chunkNumber}.json`);
}

export async function saveFileAnalysisRecord(metaPaths: MetaPaths, record: IrFileAnalysisRecord): Promise<void> {
  await writeFile(smallFileFile(metaPaths, record.relativePath), JSON.stringify(record, null, 2), "utf8");
}

/**
 * Cheap presence check — does NOT read or parse the JSON. Use this in pre-passes that need to
 * partition entries into cached vs pending without paying the deserialization cost. Returns
 * `true` only when the file exists and is readable.
 */
export async function hasFileAnalysisRecord(
  metaPaths: MetaPaths,
  relativePath: string,
): Promise<boolean> {
  try {
    await access(smallFileFile(metaPaths, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function readFileAnalysisRecordIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
): Promise<IrFileAnalysisRecord | null> {
  try {
    const raw = await readFile(smallFileFile(metaPaths, relativePath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as IrFileAnalysisRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveBoundaries(metaPaths: MetaPaths, boundaries: IrBigFileBoundaries): Promise<void> {
  await writeFile(boundariesFile(metaPaths, boundaries.relativePath), JSON.stringify(boundaries, null, 2), "utf8");
}

export async function readBoundaries(
  metaPaths: MetaPaths,
  relativePath: string,
): Promise<IrBigFileBoundaries | null> {
  try {
    const raw = await readFile(boundariesFile(metaPaths, relativePath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as IrBigFileBoundaries;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists one raw chunk under `chunk-{chunkNumber}.raw.json` where `chunkNumber` is 1-based
 * (`chunk.chunkIndex + 1`). The chunkIndex field inside the file stays 0-based to match the
 * package convention from `chunkByDeclarations`.
 */
export async function saveRawChunk(metaPaths: MetaPaths, chunk: IrBigFileChunkRaw): Promise<string> {
  await mkdir(chunkDir(metaPaths, chunk.relativePath), { recursive: true, mode: DIR_MODE });
  const file = rawChunkFile(metaPaths, chunk.relativePath, chunk.chunkIndex + 1);
  await writeFile(file, JSON.stringify(chunk, null, 2), "utf8");
  return file;
}

export async function readRawChunk(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
): Promise<IrBigFileChunkRaw | null> {
  try {
    const raw = await readFile(rawChunkFile(metaPaths, relativePath, chunkNumber), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as IrBigFileChunkRaw;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists one analysed chunk under `chunk-{chunkNumber}.json`. The record body is the unmodified
 * file-analysis result — no chunk index / line range encoded inside; the chunk number lives only
 * in the filename, and `relativePath` matches the parent file (shared across all chunks).
 */
export async function saveAnalysedChunk(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
  record: IrFileAnalysisRecord,
): Promise<string> {
  await mkdir(chunkDir(metaPaths, relativePath), { recursive: true, mode: DIR_MODE });
  const file = analysedChunkFile(metaPaths, relativePath, chunkNumber);
  await writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

export async function readAnalysedChunkIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
): Promise<IrFileAnalysisRecord | null> {
  try {
    const raw = await readFile(analysedChunkFile(metaPaths, relativePath, chunkNumber), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as IrFileAnalysisRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/** Lists every raw chunk's 1-based chunk number on disk for one file (sorted ascending). */
export async function listRawChunkNumbers(metaPaths: MetaPaths, relativePath: string): Promise<number[]> {
  let entries: string[];
  try {
    entries = await readdir(chunkDir(metaPaths, relativePath));
  } catch {
    return [];
  }
  const numbers: number[] = [];
  for (const name of entries) {
    const match = /^chunk-(\d+)\.raw\.json$/u.exec(name);
    if (match === null) {
      continue;
    }
    const numStr = match[1];
    if (numStr === undefined) {
      continue;
    }
    numbers.push(Number.parseInt(numStr, 10));
  }
  return numbers.sort((a, b) => a - b);
}
