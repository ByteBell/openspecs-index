import { writeFile } from "node:fs/promises";
import { askJsonLLM, tokenLen, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import type { MetaPaths } from "@bb/ingest-core";
import { throwIfCancelled } from "@bb/ingest-core";
import { iterateFolderSummaries } from "./folder-summary.ts";
import {
  REPO_SUMMARY_SYSTEM_PROMPT,
  buildRepoMergePrompt,
  buildRepoPromptFromFolders,
  repoFolderInfosFrom,
  type RepoFolderInfo,
} from "./prompts/repo-summary.ts";
import type { FolderSummary, RepoSummary, RepoSummaryEnvelope } from "./types.ts";
import { ZERO_USAGE, addUsage } from "@bb/ingest-core";

interface RepoSummaryJson {
  purpose?: unknown;
  summary?: unknown;
  keywords?: unknown;
  architecture?: unknown;
  majorSubsystems?: unknown;
  dataFlow?: unknown;
  keyPatterns?: unknown;
}

export async function summariseRepo(
  knowledgeId: string,
  metaPaths: MetaPaths,
  llmCallContext?: AskLlmOptions,
): Promise<{
  summary: RepoSummary | null;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
  cachedTokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}> {
  const folders: FolderSummary[] = [];
  for await (const f of iterateFolderSummaries(metaPaths)) {
    folders.push(f);
  }
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let cached = { ...ZERO_USAGE };
  if (folders.length === 0) {
    logger.warn(`phase6: no folder summaries on disk; skipping repo summary`);
    return { summary: null, tokenUsage: { ...ZERO_USAGE }, cachedTokenUsage: { ...ZERO_USAGE } };
  }
  folders.sort((a, b) => a.folderPath.split("/").length - b.folderPath.split("/").length);
  const infos = repoFolderInfosFrom(folders);
  const contextLimit = getConfigValue(Config.ContextWindowLimit);
  const promptOverhead = getConfigValue(Config.CondensePromptOverhead);

  const oneShotPrompt = buildRepoPromptFromFolders(infos);
  if (tokenLen(oneShotPrompt) + promptOverhead <= contextLimit) {
    throwIfCancelled(knowledgeId);
    return await callRepoSummary(oneShotPrompt, llmCallContext);
  }

  logger.info(`phase6: repo prompt > ${contextLimit} tokens; batching`);
  const batches = batchFolders(infos, contextLimit - promptOverhead);
  const partials: string[] = [];
  for (const batch of batches) {
    throwIfCancelled(knowledgeId);
    const {
      summary: partial,
      tokenUsage,
      cachedTokenUsage,
    } = await callRepoSummary(buildRepoPromptFromFolders(batch), llmCallContext);
    totalInputTokens += tokenUsage.inputTokens;
    totalOutputTokens += tokenUsage.outputTokens;
    totalCostUsd += tokenUsage.costUsd;
    cached = addUsage(cached, cachedTokenUsage);
    if (partial !== null) {
      partials.push(JSON.stringify(partial));
    }
  }
  if (partials.length === 0) {
    return {
      summary: null,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
      cachedTokenUsage: cached,
    };
  }
  if (partials.length === 1) {
    return {
      summary: JSON.parse(partials[0] ?? "null") as RepoSummary | null,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: totalCostUsd },
      cachedTokenUsage: cached,
    };
  }
  throwIfCancelled(knowledgeId);
  const {
    summary: final,
    tokenUsage: finalUsage,
    cachedTokenUsage: finalCached,
  } = await callRepoSummary(buildRepoMergePrompt(partials), llmCallContext);
  return {
    summary: final,
    tokenUsage: {
      inputTokens: totalInputTokens + finalUsage.inputTokens,
      outputTokens: totalOutputTokens + finalUsage.outputTokens,
      costUsd: totalCostUsd + finalUsage.costUsd,
    },
    cachedTokenUsage: addUsage(cached, finalCached),
  };
}

async function callRepoSummary(
  userPrompt: string,
  llmCallContext?: AskLlmOptions,
): Promise<{
  summary: RepoSummary | null;
  tokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
  cachedTokenUsage: { inputTokens: number; outputTokens: number; costUsd: number };
}> {
  try {
    const response = await askJsonLLM<RepoSummaryJson>(REPO_SUMMARY_SYSTEM_PROMPT, userPrompt, llmCallContext ?? {});
    const tokenUsage = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      costUsd: response.usage.costUsd,
    };
    const cachedTokenUsage = response.usage.cached === true ? { ...tokenUsage } : { ...ZERO_USAGE };
    if (response.result === null) {
      return { summary: null, tokenUsage, cachedTokenUsage };
    }
    return { summary: shapeRepoSummary(response.result), tokenUsage, cachedTokenUsage };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`callRepoSummary: askJsonLLM failed: ${msg}`);
    return { summary: null, tokenUsage: { ...ZERO_USAGE }, cachedTokenUsage: { ...ZERO_USAGE } };
  }
}

export async function persistRepoSummary(metaPaths: MetaPaths, envelope: RepoSummaryEnvelope): Promise<void> {
  await writeFile(metaPaths.repoSummaryJson, JSON.stringify(envelope, null, 2), "utf8");
}

export function makeRepoSummaryEnvelope(
  knowledgeId: string,
  orgId: string,
  repoSummary: RepoSummary,
): RepoSummaryEnvelope {
  return {
    generatedAt: new Date().toISOString(),
    version: "v2-flat",
    source: "folder-summaries",
    knowledgeId,
    orgId,
    repoSummary,
  };
}

function batchFolders(infos: RepoFolderInfo[], budget: number): RepoFolderInfo[][] {
  const batches: RepoFolderInfo[][] = [];
  let current: RepoFolderInfo[] = [];
  let currentTokens = 0;
  for (const info of infos) {
    const serialized = `${info.folderPath}|${info.purpose}|${info.summary}|${info.keywords.join(",")}`;
    const t = tokenLen(serialized);
    if (currentTokens + t > budget && current.length > 0) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(info);
    currentTokens += t;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

function shapeRepoSummary(raw: RepoSummaryJson): RepoSummary {
  return {
    purpose: pickString(raw.purpose),
    summary: pickString(raw.summary),
    keywords: pickStringArray(raw.keywords),
    architecture: pickString(raw.architecture),
    majorSubsystems: pickStringArray(raw.majorSubsystems),
    dataFlow: pickString(raw.dataFlow),
    keyPatterns: pickStringArray(raw.keyPatterns),
  };
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value : "";
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
