import { readFile, writeFile } from "node:fs/promises";
import { tokenLen } from "@bb/llm";
import { logger } from "@bb/logger";
import type { BigFileEntry, BigFileReason } from "#src/types/big-file.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";

export function classifyByTokens(
  content: string,
  contextWindowLimit: number,
): { tokenCount: number; isBigFile: boolean } {
  const tokenCount = tokenLen(content);
  return { tokenCount, isBigFile: tokenCount > contextWindowLimit };
}

export function buildBigFileEntry(
  relativePath: string,
  sizeBytes: number,
  tokenCount: number,
  reason: BigFileReason,
): BigFileEntry {
  return { relativePath, sizeBytes, tokenCount, reason };
}

export async function readBigFiles(metaPaths: MetaPaths): Promise<BigFileEntry[]> {
  try {
    const raw = await readFile(metaPaths.bigFilesJson, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: BigFileEntry[] = [];
    for (const item of parsed) {
      const narrowed = narrowEntry(item);
      if (narrowed !== null) {
        out.push(narrowed);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function writeBigFiles(metaPaths: MetaPaths, entries: BigFileEntry[]): Promise<void> {
  const deduped = dedupeByPath(entries);
  await writeFile(metaPaths.bigFilesJson, JSON.stringify(deduped, null, 2), "utf8");
  logger.info(`big-file/detector: wrote ${deduped.length} entries to ${metaPaths.bigFilesJson}`);
}

export async function appendBigFileEntry(metaPaths: MetaPaths, entry: BigFileEntry): Promise<void> {
  const existing = await readBigFiles(metaPaths);
  existing.push(entry);
  await writeBigFiles(metaPaths, existing);
}

function dedupeByPath(entries: BigFileEntry[]): BigFileEntry[] {
  const seen = new Map<string, BigFileEntry>();
  for (const entry of entries) {
    seen.set(entry.relativePath, entry);
  }
  return [...seen.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function narrowEntry(value: unknown): BigFileEntry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const relativePath = rec["relativePath"];
  const sizeBytes = rec["sizeBytes"];
  const tokenCount = rec["tokenCount"];
  const reason = rec["reason"];
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return null;
  }
  if (typeof sizeBytes !== "number" || typeof tokenCount !== "number") {
    return null;
  }
  if (reason !== "too-large" && reason !== "context-window-exceeded") {
    return null;
  }
  return { relativePath, sizeBytes, tokenCount, reason };
}
