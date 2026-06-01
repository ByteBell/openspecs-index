/**
 * Disk I/O for the IR strategy's persisted records. Every path is resolved through the path
 * builders in `#src/pipeline/paths.ts` — this module does NOT compose any paths itself.
 *
 * Layout (path builder → consumer):
 *   - `fileAnalysisRecordPath`     → `IrFileAnalysisRecord` for small files
 *   - `bigFileBoundariesPath`      → `IrBigFileBoundaries`
 *   - `bigFileChunkDir`            → directory enumerated by `listRawChunkNumbers`
 *   - `bigFileRawChunkPath`        → `IrBigFileChunkRaw`
 *   - `bigFileAnalysedChunkPath`   → `IrFileAnalysisRecord` for one big-file chunk
 *   - `unitSourceRecordPath`       → `IrUnitSourceRecord`
 *   - `unitAnalysisRecordPath`     → `IrUnitAnalysisRecord`
 */
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  bigFileAnalysedChunkPath,
  bigFileBoundariesPath,
  bigFileChunkDir,
  bigFileRawChunkPath,
  fileAnalysisRecordPath,
  unitAnalysisRecordPath,
  unitDirFor,
  unitSourceRecordPath,
} from "#src/pipeline/paths.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type {
  IrBigFileBoundaries,
  IrBigFileChunkRaw,
  IrFileAnalysisRecord,
} from "./records.ts";
import type { IrUnitAnalysisRecord, IrUnitSourceRecord } from "./types.ts";

const DIR_MODE = 0o700;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent<T>(file: string): Promise<T | null> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveFileAnalysisRecord(metaPaths: MetaPaths, record: IrFileAnalysisRecord): Promise<void> {
  await writeFile(fileAnalysisRecordPath(metaPaths, record.relativePath), JSON.stringify(record, null, 2), "utf8");
}

/**
 * Cheap presence check — does NOT read or parse the JSON. Use this in pre-passes that need to
 * partition entries into cached vs pending without paying the deserialization cost.
 */
export async function hasFileAnalysisRecord(metaPaths: MetaPaths, relativePath: string): Promise<boolean> {
  return exists(fileAnalysisRecordPath(metaPaths, relativePath));
}

export async function readFileAnalysisRecordIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
): Promise<IrFileAnalysisRecord | null> {
  return readJsonIfPresent<IrFileAnalysisRecord>(fileAnalysisRecordPath(metaPaths, relativePath));
}

export async function saveBoundaries(metaPaths: MetaPaths, boundaries: IrBigFileBoundaries): Promise<void> {
  await writeFile(
    bigFileBoundariesPath(metaPaths, boundaries.relativePath),
    JSON.stringify(boundaries, null, 2),
    "utf8",
  );
}

export async function readBoundaries(
  metaPaths: MetaPaths,
  relativePath: string,
): Promise<IrBigFileBoundaries | null> {
  return readJsonIfPresent<IrBigFileBoundaries>(bigFileBoundariesPath(metaPaths, relativePath));
}

/**
 * Persists one raw chunk under `chunk-{chunkNumber}.raw.json` where `chunkNumber` is 1-based
 * (`chunk.chunkIndex + 1`). The chunkIndex field inside the file stays 0-based to match the
 * package convention from `chunkByDeclarations`.
 */
export async function saveRawChunk(metaPaths: MetaPaths, chunk: IrBigFileChunkRaw): Promise<string> {
  await mkdir(bigFileChunkDir(metaPaths, chunk.relativePath), { recursive: true, mode: DIR_MODE });
  const file = bigFileRawChunkPath(metaPaths, chunk.relativePath, chunk.chunkIndex + 1);
  await writeFile(file, JSON.stringify(chunk, null, 2), "utf8");
  return file;
}

export async function readRawChunk(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
): Promise<IrBigFileChunkRaw | null> {
  return readJsonIfPresent<IrBigFileChunkRaw>(bigFileRawChunkPath(metaPaths, relativePath, chunkNumber));
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
  await mkdir(bigFileChunkDir(metaPaths, relativePath), { recursive: true, mode: DIR_MODE });
  const file = bigFileAnalysedChunkPath(metaPaths, relativePath, chunkNumber);
  await writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

export async function readAnalysedChunkIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
): Promise<IrFileAnalysisRecord | null> {
  return readJsonIfPresent<IrFileAnalysisRecord>(bigFileAnalysedChunkPath(metaPaths, relativePath, chunkNumber));
}

/** Lists every raw chunk's 1-based chunk number on disk for one file (sorted ascending). */
export async function listRawChunkNumbers(metaPaths: MetaPaths, relativePath: string): Promise<number[]> {
  let entries: string[];
  try {
    entries = await readdir(bigFileChunkDir(metaPaths, relativePath));
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

/** Persists one {@link IrUnitSourceRecord} under its `<safeUnit>.source.json`. */
export async function saveUnitSourceRecord(metaPaths: MetaPaths, record: IrUnitSourceRecord): Promise<string> {
  await mkdir(unitDirFor(metaPaths, record.relativePath, record.chunkNumber), { recursive: true, mode: DIR_MODE });
  const file = unitSourceRecordPath(metaPaths, record.relativePath, record.chunkNumber, record.qualifiedName);
  await writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

export async function hasUnitSourceRecord(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
  qualifiedName: string,
): Promise<boolean> {
  return exists(unitSourceRecordPath(metaPaths, relativePath, chunkNumber, qualifiedName));
}

export async function readUnitSourceRecordIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
  qualifiedName: string,
): Promise<IrUnitSourceRecord | null> {
  return readJsonIfPresent<IrUnitSourceRecord>(
    unitSourceRecordPath(metaPaths, relativePath, chunkNumber, qualifiedName),
  );
}

/** Persists one {@link IrUnitAnalysisRecord} under its `<safeUnit>.analysis.json`. */
export async function saveUnitAnalysisRecord(metaPaths: MetaPaths, record: IrUnitAnalysisRecord): Promise<string> {
  await mkdir(unitDirFor(metaPaths, record.relativePath, record.chunkNumber), { recursive: true, mode: DIR_MODE });
  const file = unitAnalysisRecordPath(metaPaths, record.relativePath, record.chunkNumber, record.qualifiedName);
  await writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

export async function hasUnitAnalysisRecord(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
  qualifiedName: string,
): Promise<boolean> {
  return exists(unitAnalysisRecordPath(metaPaths, relativePath, chunkNumber, qualifiedName));
}

export async function readUnitAnalysisRecordIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
  qualifiedName: string,
): Promise<IrUnitAnalysisRecord | null> {
  return readJsonIfPresent<IrUnitAnalysisRecord>(
    unitAnalysisRecordPath(metaPaths, relativePath, chunkNumber, qualifiedName),
  );
}

/**
 * Lists every `*.source.json` filename in a unit directory (sorted). Returns `[]` when the
 * directory does not exist yet. Used by Phase 7 to enumerate the work pending for one
 * file/chunk pair.
 */
export async function listUnitSourceFiles(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number | null,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(unitDirFor(metaPaths, relativePath, chunkNumber));
  } catch {
    return [];
  }
  return entries.filter((n) => n.endsWith(".source.json")).sort();
}

