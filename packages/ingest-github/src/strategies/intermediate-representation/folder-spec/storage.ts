/**
 * Disk I/O for `FolderSpecRecord`. Persistence is parallel to file-analysis: each folder gets
 * its own directory under `metaRoot/folder-specs/<encoded-folder>/spec.json`. Repo root maps
 * to `metaRoot/folder-specs/__ROOT__/spec.json`.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { logger } from "@bb/logger";
import { folderSpecDir, folderSpecRecordPath } from "#src/pipeline/paths.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { FolderSpecRecord } from "./types.ts";

const DIR_MODE = 0o700;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** True iff a FolderSpec already exists on disk for `folderPath`. */
export async function hasFolderSpecRecord(metaPaths: MetaPaths, folderPath: string): Promise<boolean> {
  return exists(folderSpecRecordPath(metaPaths, folderPath));
}

/** Saves a FolderSpec record to disk; creates the folder directory if missing. */
export async function saveFolderSpecRecord(
  metaPaths: MetaPaths,
  record: FolderSpecRecord,
): Promise<void> {
  const dir = folderSpecDir(metaPaths, record.folderPath);
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const file = folderSpecRecordPath(metaPaths, record.folderPath);
  await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 });
  logger.debug(`folder-spec: saved ${file}`);
}

/** Reads a FolderSpec record from disk, or `null` when absent or malformed. */
export async function readFolderSpecRecordIfPresent(
  metaPaths: MetaPaths,
  folderPath: string,
): Promise<FolderSpecRecord | null> {
  const file = folderSpecRecordPath(metaPaths, folderPath);
  if (!(await exists(file))) {
    return null;
  }
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as FolderSpecRecord;
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`folder-spec: failed to read ${file}: ${msg}`);
    return null;
  }
}
