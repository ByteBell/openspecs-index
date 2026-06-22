import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ScanDeps, ScanEntry, SourceReader } from "#src/types/pipeline.ts";
import { scanRepository } from "./scan.ts";

export interface DiskSourceReaderDeps {
  repoDir: string;
  commitHash: string;
  /** ISO-8601 committed timestamp of `commitHash`. Optional; surfaced as `SourceReader.commitDate`. */
  commitDate?: string | null;
}

export function createDiskSourceReader(deps: DiskSourceReaderDeps): SourceReader {
  return {
    commitHash: deps.commitHash,
    commitDate: deps.commitDate ?? null,
    localRepoDir: deps.repoDir,
    scan(scanDeps?: ScanDeps): AsyncGenerator<ScanEntry> {
      return scanRepository(deps.repoDir, scanDeps);
    },
    async readFile(relativePath: string): Promise<string> {
      return await readFile(path.join(deps.repoDir, relativePath), "utf8");
    },
  };
}
