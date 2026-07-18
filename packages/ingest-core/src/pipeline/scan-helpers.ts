import { createHash } from "node:crypto";
import { logger } from "@bb/logger";
import type { AskLlmOptions } from "@bb/llm";
import type { SkipDecider } from "#src/types/pipeline.ts";
import type { ConcurrencyLimiter } from "./concurrency.ts";
import type { EffectiveIgnoreSets } from "./skip-decisions/effective.ts";

/** Config-resolved size/line thresholds a scan classifies files against. */
export interface ScanLimits {
  absoluteCap: number;
  bigFileLineThreshold: number;
}

/** Inputs to a repository scan. Shared by the inline walk (`scan.ts`) and the two-pass walk (`scan-twopass.ts`). */
export interface ScanRepositoryDeps {
  skipDecider?: SkipDecider;
  llmCallContext?: AskLlmOptions;
  limiter?: ConcurrencyLimiter;
  /**
   * Effective ignore sets (seed defaults overlaid with per-job overrides). Used
   * for directory-walk pruning and the path filter. When omitted, the built-in
   * `SKIP_DIRS` / `SKIP_FILES` / `BINARY_EXTENSIONS` defaults apply (unchanged).
   */
  ignoreSets?: EffectiveIgnoreSets;
  /**
   * Ingest-run identity used to attribute skipped files to a knowledge + org in the `ignored_files`
   * audit collection. All three are absent in OSS standalone / legacy runs — the scan then records
   * nothing (see `makeIgnoreSink`). `commitHash` stamps each audit row with the scanned commit.
   */
  knowledgeId?: string;
  orgId?: string;
  commitHash?: string;
}

/** Running tally of scan outcomes, logged once per scan. */
export interface ScanCounts {
  acceptStatic: number;
  acceptLlm: number;
  rejectStatic: number;
  rejectLlm: number;
  oversized: number;
  binary: number;
}

export function newCounts(): ScanCounts {
  return { acceptStatic: 0, acceptLlm: 0, rejectStatic: 0, rejectLlm: 0, oversized: 0, binary: 0 };
}

export function logCounts(counts: ScanCounts): void {
  logger.info(
    `scan: acceptStatic=${counts.acceptStatic} acceptLlm=${counts.acceptLlm} rejectStatic=${counts.rejectStatic} rejectLlm=${counts.rejectLlm} oversized=${counts.oversized} binary=${counts.binary}`,
  );
}

/**
 * Per-file admission-gate dedupe key: hash the content so identical file
 * contents collapse to a single LLM call while distinct files each get their
 * own verdict. Matches the content-hash key used by the decider's `files` cache.
 */
export function decisionKey(content: string): string {
  return `file:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/** Fast newline count (counts LF; a non-empty file is at least one line). */
export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) {
      lines += 1;
    }
  }
  return lines;
}
