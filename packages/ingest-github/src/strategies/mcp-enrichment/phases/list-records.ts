/**
 * Discovers every file-analysis record on disk under a {@link MetaPaths} root. Returns a flat
 * list of targets the strategy must enrich: one entry per small file, one per big-file chunk.
 * Reads the records themselves to recover `relativePath` (the encoded filename is not decoded
 * here — the record's stored `relativePath` is authoritative).
 *
 * The strategy uses this output to drive its per-record loop; the listing is cheap (one
 * readdir per dir + one read per record).
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "@bb/logger";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { IrFileAnalysisRecord } from "#src/strategies/intermediate-representation/records.ts";

/** One target the mcp-enrichment strategy will process. */
export interface EnrichmentTarget {
  relativePath: string;
  /** Set for big-file chunks; absent for small files. */
  chunkNumber?: number;
  /** Absolute path to the file-analysis JSON record on disk. */
  recordFile: string;
}

async function readRecord(file: string): Promise<IrFileAnalysisRecord | null> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as IrFileAnalysisRecord;
    }
    return null;
  } catch (cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`mcp-enrichment: failed to read record ${file}: ${msg}`);
    return null;
  }
}

async function listSmallTargets(metaPaths: MetaPaths): Promise<EnrichmentTarget[]> {
  let entries: string[];
  try {
    entries = await readdir(metaPaths.fileAnalysisDir);
  } catch {
    return [];
  }
  const targets: EnrichmentTarget[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const file = path.join(metaPaths.fileAnalysisDir, name);
    const record = await readRecord(file);
    if (record === null) {
      continue;
    }
    targets.push({ relativePath: record.relativePath, recordFile: file });
  }
  return targets;
}

async function listChunkTargetsForFile(
  parentDir: string,
  encodedName: string,
): Promise<EnrichmentTarget[]> {
  const fileChunkDir = path.join(parentDir, encodedName);
  let chunkEntries: string[];
  try {
    chunkEntries = await readdir(fileChunkDir);
  } catch {
    return [];
  }
  const targets: EnrichmentTarget[] = [];
  for (const chunkName of chunkEntries) {
    const match = /^chunk-(\d+)\.json$/u.exec(chunkName);
    if (match === null) {
      continue;
    }
    const numStr = match[1];
    if (numStr === undefined) {
      continue;
    }
    const chunkNumber = Number.parseInt(numStr, 10);
    const file = path.join(fileChunkDir, chunkName);
    const record = await readRecord(file);
    if (record === null) {
      continue;
    }
    targets.push({ relativePath: record.relativePath, chunkNumber, recordFile: file });
  }
  return targets;
}

async function listChunkTargets(metaPaths: MetaPaths): Promise<EnrichmentTarget[]> {
  let entries: string[];
  try {
    entries = await readdir(metaPaths.bigFileChunksDir);
  } catch {
    return [];
  }
  const targets: EnrichmentTarget[] = [];
  for (const name of entries) {
    const fileChunkDir = path.join(metaPaths.bigFileChunksDir, name);
    let info;
    try {
      info = await stat(fileChunkDir);
    } catch {
      continue;
    }
    if (!info.isDirectory()) {
      continue;
    }
    const fileTargets = await listChunkTargetsForFile(metaPaths.bigFileChunksDir, name);
    targets.push(...fileTargets);
  }
  return targets;
}

/**
 * Returns every target (small file + every big-file chunk) the strategy must enrich.
 *
 * @param metaPaths - The MetaPaths root of the file-analysis run.
 * @returns The list of targets (possibly empty). Order: small files first, then chunks.
 */
export async function listEnrichmentTargets(metaPaths: MetaPaths): Promise<EnrichmentTarget[]> {
  const small = await listSmallTargets(metaPaths);
  const chunks = await listChunkTargets(metaPaths);
  return [...small, ...chunks];
}
