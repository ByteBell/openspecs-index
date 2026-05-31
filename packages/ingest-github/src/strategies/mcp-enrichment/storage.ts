/**
 * Disk I/O for the `mcp-enrichment` strategy. Paths are computed from {@link MetaPaths} and
 * encoded with `encodeMetaPath` (shared with the IR strategy) so the enrichment record for
 * pass-1 file `<encoded>.json` sits at `mcpEnrichmentDir/<encoded>.json`.
 *
 * Small file:        `mcpEnrichmentDir/<encoded>.json`
 * Big-file chunk N:  `mcpEnrichmentDir/<encoded>/chunk-N.json`
 *
 * Cheap presence checks (`has*`) only `access()` the file; full reads parse the JSON.
 * All writes go through `node:fs/promises` and create parent dirs as needed.
 */
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeMetaPath } from "#src/pipeline/paths.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { McpEnrichmentRecord } from "./records.ts";

const DIR_MODE = 0o700;

function smallEnrichmentFile(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.mcpEnrichmentDir, `${encodeMetaPath(relativePath)}.json`);
}

function chunkEnrichmentDir(metaPaths: MetaPaths, relativePath: string): string {
  return path.join(metaPaths.mcpEnrichmentDir, encodeMetaPath(relativePath));
}

function chunkEnrichmentFile(metaPaths: MetaPaths, relativePath: string, chunkNumber: number): string {
  return path.join(chunkEnrichmentDir(metaPaths, relativePath), `chunk-${chunkNumber}.json`);
}

/**
 * Saves a small-file enrichment record. Creates `mcpEnrichmentDir` lazily; subsequent calls
 * reuse it.
 */
export async function saveSmallEnrichment(
  metaPaths: MetaPaths,
  record: McpEnrichmentRecord,
): Promise<void> {
  await mkdir(metaPaths.mcpEnrichmentDir, { recursive: true, mode: DIR_MODE });
  await writeFile(
    smallEnrichmentFile(metaPaths, record.relativePath),
    JSON.stringify(record, null, 2),
    "utf8",
  );
}

/**
 * Saves a big-file chunk enrichment record under its per-file directory. Creates the directory
 * lazily.
 */
export async function saveChunkEnrichment(
  metaPaths: MetaPaths,
  record: McpEnrichmentRecord,
): Promise<void> {
  if (record.chunkNumber === undefined) {
    throw new Error("saveChunkEnrichment: chunkNumber is required");
  }
  await mkdir(chunkEnrichmentDir(metaPaths, record.relativePath), { recursive: true, mode: DIR_MODE });
  await writeFile(
    chunkEnrichmentFile(metaPaths, record.relativePath, record.chunkNumber),
    JSON.stringify(record, null, 2),
    "utf8",
  );
}

/** Cheap presence check — does NOT read or parse the JSON. */
export async function hasSmallEnrichment(metaPaths: MetaPaths, relativePath: string): Promise<boolean> {
  try {
    await access(smallEnrichmentFile(metaPaths, relativePath));
    return true;
  } catch {
    return false;
  }
}

/** Cheap presence check for one chunk's enrichment. */
export async function hasChunkEnrichment(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
): Promise<boolean> {
  try {
    await access(chunkEnrichmentFile(metaPaths, relativePath, chunkNumber));
    return true;
  } catch {
    return false;
  }
}

/** Reads + parses a small-file enrichment record, or returns null when absent / malformed. */
export async function readSmallEnrichmentIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
): Promise<McpEnrichmentRecord | null> {
  try {
    const raw = await readFile(smallEnrichmentFile(metaPaths, relativePath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as McpEnrichmentRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/** Reads + parses one chunk's enrichment record, or null when absent / malformed. */
export async function readChunkEnrichmentIfPresent(
  metaPaths: MetaPaths,
  relativePath: string,
  chunkNumber: number,
): Promise<McpEnrichmentRecord | null> {
  try {
    const raw = await readFile(chunkEnrichmentFile(metaPaths, relativePath, chunkNumber), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as McpEnrichmentRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/** Deletes a small-file enrichment record. Silent on missing file. */
export async function deleteSmallEnrichment(metaPaths: MetaPaths, relativePath: string): Promise<void> {
  try {
    await rm(smallEnrichmentFile(metaPaths, relativePath));
  } catch {
    // missing or unreadable — treat as already-deleted.
  }
}

/** Deletes every chunk enrichment for one big file (the whole chunk dir). Silent on missing dir. */
export async function deleteAllChunkEnrichments(
  metaPaths: MetaPaths,
  relativePath: string,
): Promise<void> {
  try {
    await rm(chunkEnrichmentDir(metaPaths, relativePath), { recursive: true, force: true });
  } catch {
    // missing — nothing to do.
  }
}
