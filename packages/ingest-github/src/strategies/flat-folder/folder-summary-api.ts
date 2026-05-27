import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import type { CondensedFileAnalysis } from "#src/types/condensed-file-analysis.ts";
import type { MetaPaths } from "#src/types/meta-paths.ts";
import { encodeMetaPath } from "#src/pipeline/paths.ts";
import {
  FOLDER_ANALYSIS_SYSTEM_PROMPT,
  FOLDER_BATCH_SYSTEM_PROMPT,
  folderAnalysisUserPrompt,
  folderBatchUserPrompt,
  type BatchedFolderInput,
} from "./prompts/folder-summary.ts";
import type { FolderSummary } from "./types.ts";

export interface FolderBucket {
  folderPath: string;
  files: CondensedFileAnalysis[];
}

interface FolderSummaryJson {
  purpose?: unknown;
  summary?: unknown;
  keywords?: unknown;
  classes?: unknown;
  functions?: unknown;
  importsInternal?: unknown;
  importsExternal?: unknown;
  dependencyGraph?: unknown;
}

/**
 * Splits the folder groups into "individual" (one LLM call per folder, used
 * for big folders or when batching is disabled) and "batches" (N small
 * folders summarised in one LLM call). Driven by `Config.FolderSummaryBatchSize`
 * (set to 1 to disable batching entirely) and `Config.FolderSummaryBatchMaxFiles`
 * (folders exceeding this file count always take the individual path).
 *
 * Folders are sorted by path so that two runs of the same repo produce the
 * same batch composition — helpful when A/B-comparing outputs.
 */
export function groupFoldersForBatching(groups: Map<string, CondensedFileAnalysis[]>): {
  individual: FolderBucket[];
  batches: FolderBucket[][];
} {
  const batchSize = getConfigValue(Config.FolderSummaryBatchSize);
  const maxFiles = getConfigValue(Config.FolderSummaryBatchMaxFiles);
  const sorted: FolderBucket[] = [...groups.entries()]
    .map(([folderPath, files]) => ({ folderPath, files }))
    .sort((a, b) => a.folderPath.localeCompare(b.folderPath));

  if (batchSize <= 1) {
    return { individual: sorted, batches: [] };
  }

  const individual: FolderBucket[] = [];
  const batchable: FolderBucket[] = [];
  for (const bucket of sorted) {
    if (bucket.files.length > maxFiles) {
      individual.push(bucket);
    } else {
      batchable.push(bucket);
    }
  }

  const batches: FolderBucket[][] = [];
  for (let i = 0; i < batchable.length; i += batchSize) {
    batches.push(batchable.slice(i, i + batchSize));
  }
  return { individual, batches };
}

export async function summariseFolder(
  folderPath: string,
  files: CondensedFileAnalysis[],
  llmCallContext?: AskLlmOptions,
): Promise<{
  summary: FolderSummary | null;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}> {
  const userPrompt = folderAnalysisUserPrompt(folderPath, files);
  try {
    const response = await askJsonLLM<FolderSummaryJson>(
      FOLDER_ANALYSIS_SYSTEM_PROMPT,
      userPrompt,
      llmCallContext ?? {},
    );
    if (response.result === null) {
      logger.warn(`summariseFolder: ${folderPath || "<root>"} returned unparseable JSON`);
      return {
        summary: null,
        tokenUsage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.usage.costUsd,
        },
      };
    }
    return {
      summary: shapeFolderSummary(folderPath, response.result),
      tokenUsage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: response.usage.costUsd,
      },
    };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`summariseFolder: ${folderPath || "<root>"} askJsonLLM failed: ${msg}`);
    return { summary: null, tokenUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  }
}

/**
 * Multi-folder summary. Builds a label-indexed prompt, parses the keyed JSON
 * response, returns one `FolderSummary | null` per folder. Folders missing
 * from the response (or whose entry fails shape validation) are surfaced as
 * `null` with a warn log; the caller counts those as failed.
 */
export async function summariseFolderBatch(
  batch: FolderBucket[],
  llmCallContext?: AskLlmOptions,
): Promise<{
  summaries: Map<string, FolderSummary | null>;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}> {
  const labeled: BatchedFolderInput[] = batch.map((b, i) => ({ label: i, folderPath: b.folderPath, files: b.files }));
  const userPrompt = folderBatchUserPrompt(labeled);
  const summaries = new Map<string, FolderSummary | null>();
  try {
    const response = await askJsonLLM<Record<string, FolderSummaryJson>>(
      FOLDER_BATCH_SYSTEM_PROMPT,
      userPrompt,
      llmCallContext ?? {},
    );
    if (response.result === null) {
      logger.warn(`summariseFolderBatch: batch of ${batch.length} returned unparseable JSON`);
      for (const b of batch) {
        summaries.set(b.folderPath, null);
      }
      return {
        summaries,
        tokenUsage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.usage.costUsd,
        },
      };
    }
    for (const b of labeled) {
      const raw = response.result[String(b.label)];
      if (raw === undefined || typeof raw !== "object" || raw === null) {
        logger.warn(`summariseFolderBatch: missing/invalid entry for label ${b.label} (${b.folderPath || "<root>"})`);
        summaries.set(b.folderPath, null);
        continue;
      }
      summaries.set(b.folderPath, shapeFolderSummary(b.folderPath, raw));
    }
    return {
      summaries,
      tokenUsage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: response.usage.costUsd,
      },
    };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`summariseFolderBatch: batch of ${batch.length} askJsonLLM failed: ${msg}`);
    for (const b of batch) {
      summaries.set(b.folderPath, null);
    }
    return { summaries, tokenUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  }
}

export async function persistFolderSummary(metaPaths: MetaPaths, summary: FolderSummary): Promise<void> {
  const file = path.join(metaPaths.folderSummariesDir, `${encodeMetaPath(summary.folderPath || "__ROOT__")}.json`);
  await writeFile(file, JSON.stringify(summary, null, 2), "utf8");
}

export async function* iterateFolderSummaries(metaPaths: MetaPaths): AsyncGenerator<FolderSummary> {
  let entries: string[];
  try {
    entries = await readdir(metaPaths.folderSummariesDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await readFile(path.join(metaPaths.folderSummariesDir, name), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        yield parsed as FolderSummary;
      }
    } catch {
      continue;
    }
  }
}

export function shapeFolderSummary(folderPath: string, raw: FolderSummaryJson): FolderSummary {
  return {
    folderPath,
    purpose: pickString(raw.purpose, ""),
    summary: pickString(raw.summary, ""),
    keywords: pickStringArray(raw.keywords),
    classes: pickStringArray(raw.classes),
    functions: pickStringArray(raw.functions),
    importsInternal: pickStringArray(raw.importsInternal),
    importsExternal: pickStringArray(raw.importsExternal),
    dependencyGraph: pickString(raw.dependencyGraph, ""),
    generatedAt: new Date().toISOString(),
  };
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
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
