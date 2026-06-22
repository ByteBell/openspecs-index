import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import type { FileAnalysis, FileAnalysisSection } from "@bb/db-core";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import type { ProgressContext } from "#src/progress/types.ts";
import type { ConcurrencyLimiter } from "#src/pipeline/concurrency.ts";
import { saveCondensed } from "#src/big-file/storage.ts";
import type { FileAnalysisCache } from "#src/file-analysis-cache.ts";
import { BACKFILL_SYSTEM_PROMPT, buildBackfillUserPrompt } from "#src/prompts/backfill.ts";

const EXTENDED_ARRAY_KEYS = [
  "ontologyConcepts",
  "businessEntities",
  "systemCapabilities",
  "sideEffects",
  "configDependencies",
  "integrationSurface",
  "contractsProvided",
  "contractsConsumed",
] as const;

type ExtendedArrayKey = (typeof EXTENDED_ARRAY_KEYS)[number];

interface BackfillJson {
  keywords?: unknown;
  ontologyConcepts?: unknown;
  businessEntities?: unknown;
  systemCapabilities?: unknown;
  sideEffects?: unknown;
  configDependencies?: unknown;
  dataFlowDirection?: unknown;
  integrationSurface?: unknown;
  contractsProvided?: unknown;
  contractsConsumed?: unknown;
  sectionMap?: unknown;
}

interface NeededFlags {
  keywords: boolean;
  arrays: Record<ExtendedArrayKey, boolean>;
  dataFlow: boolean;
  sectionMap: boolean;
}

export async function backfillMissingFields(
  metaPaths: MetaPaths,
  cache: FileAnalysisCache,
  limiter: ConcurrencyLimiter,
  llmCallContext?: AskLlmOptions,
  progressContext?: ProgressContext,
): Promise<{
  updated: number;
  failed: number;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
  cachedTokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}> {
  let updated = 0;
  let failed = 0;
  let dispatched = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let cachedInputTokens = 0;
  let cachedOutputTokens = 0;
  let cachedCostUsd = 0;
  const reporter = progressContext?.reporter({
    phase: "file_analysis",
    subPhase: "backfill",
    total: { kind: "fixed", total: cache.size },
  });
  await reporter?.start();
  try {
    const tasks: Promise<void>[] = [];
    for (const entry of cache.values()) {
      const a = entry.analysis;
      const needed = computeNeeded(a);
      if (!hasAnyMissing(needed)) {
        reporter?.increment(1, { fileName: entry.relativePath });
        continue;
      }
      dispatched += 1;
      tasks.push(
        limiter(async () => {
          const userPrompt = buildBackfillUserPrompt(entry.relativePath, entry.analysis);
          try {
            const response = await askJsonLLM<BackfillJson>(BACKFILL_SYSTEM_PROMPT, userPrompt, llmCallContext ?? {});
            const result = response.result;
            // Count the backfill call's cost even when the response is unusable —
            // the tokens were spent regardless.
            totalInputTokens += response.usage.inputTokens;
            totalOutputTokens += response.usage.outputTokens;
            totalCostUsd += response.usage.costUsd;
            if (response.usage.cached === true) {
              cachedInputTokens += response.usage.inputTokens;
              cachedOutputTokens += response.usage.outputTokens;
              cachedCostUsd += response.usage.costUsd;
            }
            if (result === null) {
              reporter?.increment(1, { fileName: entry.relativePath });
              return;
            }
            applyBackfill(a, result, needed);
            // Fold this call's cost into the persisted `tokenUsage` so a later
            // retry (which skips backfill once the fields exist) still recovers
            // it via the analyse-small/big resume branch. The resumed file then
            // carries original-analysis + backfill cost as a single total.
            const prior = entry.tokenUsage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
            entry.tokenUsage = {
              inputTokens: prior.inputTokens + response.usage.inputTokens,
              outputTokens: prior.outputTokens + response.usage.outputTokens,
              costUsd: prior.costUsd + response.usage.costUsd,
            };
            await saveCondensed(metaPaths, entry);
            cache.set(entry);
            updated += 1;
          } catch (cause: unknown) {
            if (cause instanceof LlmConfigError || cause instanceof LlmError) {
              throw cause;
            }
            failed += 1;
            logger.warn(`phase3: backfill failed for ${entry.relativePath}: ${describe(cause)}`);
          } finally {
            reporter?.increment(1, { fileName: entry.relativePath });
          }
        }),
      );
    }
    logger.info(`phase3 dispatching ${dispatched} backfill tasks`);
    await Promise.all(tasks);
    logger.info(`phase3 done: updated=${updated} failed=${failed}`);
    return {
      updated,
      failed,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
      cachedTokenUsage: { inputTokens: cachedInputTokens, outputTokens: cachedOutputTokens, costUsd: cachedCostUsd },
    };
  } finally {
    reporter?.stop();
  }
}

function computeNeeded(a: FileAnalysis): NeededFlags {
  const arrays = {} as Record<ExtendedArrayKey, boolean>;
  for (const key of EXTENDED_ARRAY_KEYS) {
    const value = a[key];
    arrays[key] = value === undefined || value.length === 0;
  }
  return {
    keywords: a.keywords.length === 0,
    arrays,
    dataFlow: a.dataFlowDirection === undefined || a.dataFlowDirection.length === 0,
    sectionMap: a.sectionMap === undefined || a.sectionMap.length === 0,
  };
}

function hasAnyMissing(needed: NeededFlags): boolean {
  if (needed.keywords || needed.dataFlow || needed.sectionMap) {
    return true;
  }
  for (const key of EXTENDED_ARRAY_KEYS) {
    if (needed.arrays[key]) {
      return true;
    }
  }
  return false;
}

function applyBackfill(a: FileAnalysis, result: BackfillJson, needed: NeededFlags): void {
  if (needed.keywords) {
    a.keywords = pickStringArray(result.keywords);
  }
  for (const key of EXTENDED_ARRAY_KEYS) {
    if (needed.arrays[key]) {
      const next = pickStringArray(result[key]);
      if (next.length > 0) {
        a[key] = next;
      }
    }
  }
  if (needed.dataFlow && typeof result.dataFlowDirection === "string" && result.dataFlowDirection.length > 0) {
    a.dataFlowDirection = result.dataFlowDirection;
  }
  if (needed.sectionMap) {
    const sections = pickSections(result.sectionMap);
    if (sections.length > 0) {
      a.sectionMap = sections;
    }
  }
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}

function pickSections(value: unknown): FileAnalysisSection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: FileAnalysisSection[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const name = typeof rec["name"] === "string" ? rec["name"] : "";
    const description = typeof rec["description"] === "string" ? rec["description"] : "";
    if (name.length > 0 || description.length > 0) {
      out.push({ name, description });
    }
  }
  return out;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
