import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "@bb/logger";
import type { CondensedFileAnalysis } from "#src/types/condensed-file-analysis.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import { withConcurrency } from "#src/pipeline/concurrency.ts";

const LOAD_CONCURRENCY = 20;

/**
 * In-memory snapshot of every `CondensedFileAnalysis` JSON under
 * `metaPaths.fileAnalysisDir`. Loaded once per strategy run between the
 * analyse phases (2a/2b) and the backfill / folder-summary / graph-store
 * phases. The downstream consumers iterate `.values()` (full sweeps) or
 * `.get(relativePath)` (random-access); Phase 3 also calls `.set(...)`
 * to keep the map in sync with disk writes.
 *
 * Replaces three sequential `iterateCondensed` walks (one per consumer)
 * with one parallel preload + three in-memory iterations.
 */
export class FileAnalysisCache {
  private readonly map: Map<string, CondensedFileAnalysis>;

  private constructor(map: Map<string, CondensedFileAnalysis>) {
    this.map = map;
  }

  static async loadAll(metaPaths: MetaPaths): Promise<FileAnalysisCache> {
    const startedAt = Date.now();
    let filenames: string[];
    try {
      filenames = await readdir(metaPaths.fileAnalysisDir);
    } catch (cause: unknown) {
      logger.warn(`file-analysis-cache: readdir failed for ${metaPaths.fileAnalysisDir}: ${describe(cause)}`);
      return new FileAnalysisCache(new Map());
    }
    const jsonFiles = filenames.filter((n) => n.endsWith(".json"));
    const map = new Map<string, CondensedFileAnalysis>();
    const limit = withConcurrency(LOAD_CONCURRENCY);
    const tasks: Promise<void>[] = [];
    for (const name of jsonFiles) {
      tasks.push(
        limit(async () => {
          const full = path.join(metaPaths.fileAnalysisDir, name);
          try {
            const raw = await readFile(full, "utf8");
            const parsed: unknown = JSON.parse(raw);
            if (typeof parsed !== "object" || parsed === null) {
              return;
            }
            const entry = parsed as CondensedFileAnalysis;
            if (typeof entry.relativePath !== "string" || entry.relativePath.length === 0) {
              return;
            }
            map.set(entry.relativePath, entry);
          } catch (cause: unknown) {
            logger.warn(`file-analysis-cache: failed to read ${name}: ${describe(cause)}`);
          }
        }),
      );
    }
    await Promise.all(tasks);
    const elapsedMs = Date.now() - startedAt;
    logger.info(`file-analysis-cache: loaded ${map.size} entries in ${elapsedMs} ms`);
    return new FileAnalysisCache(map);
  }

  get(relativePath: string): CondensedFileAnalysis | undefined {
    return this.map.get(relativePath);
  }

  set(entry: CondensedFileAnalysis): void {
    this.map.set(entry.relativePath, entry);
  }

  values(): IterableIterator<CondensedFileAnalysis> {
    return this.map.values();
  }

  entries(): IterableIterator<[string, CondensedFileAnalysis]> {
    return this.map.entries();
  }

  get size(): number {
    return this.map.size;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
