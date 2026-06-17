import { readFile, writeFile } from "node:fs/promises";
import type { MetaPaths } from "#src/types/meta-paths.ts";

export type ScanEntryKind = "small" | "big" | "oversized";

export interface ScanManifestEntry {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  tokenCount: number;
  kind: ScanEntryKind;
  estimatedChunks?: number;
}

export interface ScanManifestSummary {
  totalFiles: number;
  smallCount: number;
  bigCount: number;
  oversizedCount: number;
  totalTokens: number;
  estimatedBigChunks: number;
}

export interface ScanManifest {
  generatedAt: string;
  /**
   * The commit the manifest was scanned at. Optional: when present, a consumer can treat an
   * existing manifest stamped with the current commit as an authoritative cache hit and skip the
   * rescan. Manifests written before this field force a fresh scan.
   */
  commitHash?: string;
  summary: ScanManifestSummary;
  entries: ScanManifestEntry[];
}

export function emptyManifest(commitHash?: string): ScanManifest {
  return {
    generatedAt: new Date().toISOString(),
    ...(commitHash !== undefined ? { commitHash } : {}),
    summary: { totalFiles: 0, smallCount: 0, bigCount: 0, oversizedCount: 0, totalTokens: 0, estimatedBigChunks: 0 },
    entries: [],
  };
}

export async function writeScanManifest(metaPaths: MetaPaths, manifest: ScanManifest): Promise<void> {
  await writeFile(metaPaths.scanManifestJson, JSON.stringify(manifest, null, 2), "utf8");
}

export async function readScanManifest(metaPaths: MetaPaths): Promise<ScanManifest | null> {
  try {
    const raw = await readFile(metaPaths.scanManifestJson, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isManifest(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isManifest(value: unknown): value is ScanManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return Array.isArray(rec["entries"]) && typeof rec["summary"] === "object" && typeof rec["generatedAt"] === "string";
}
