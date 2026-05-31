/**
 * `mcp-enrichment` strategy facade — runs cross-file enrichment over every file-analysis record
 * produced by the IR strategy. Sibling to `intermediate-representation/` and `flat-folder/`.
 *
 * Flow per `execute()` call:
 *
 *   1. Read `Config.McpEnrichmentUrl` (required) + optional `Config.McpEnrichmentAuthHeader`.
 *   2. Probe the MCP URL. If unreachable, fail the job.
 *   3. List every file-analysis record on disk (small files + big-file chunks).
 *   4. For each record, run the per-record agent loop in `phases/enrich.ts` and write the
 *      resulting `McpEnrichmentRecord` to `mcpEnrichmentDir/<encoded>.json` (or chunk path).
 *   5. Sum token usage and emit a `StrategyResult`.
 *
 * The original file-analysis records on disk are NEVER mutated. mcp-enrichment writes only
 * to `mcpEnrichmentDir`.
 */
import { readFile } from "node:fs/promises";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import { throwIfCancelled } from "#src/pipeline/cancellation.ts";
import { classifyFailure } from "#src/pipeline/failure-classifier.ts";
import { withConcurrency } from "#src/pipeline/concurrency.ts";
import type { IngestStrategy, StrategyInput, StrategyResult } from "#src/types/strategy.ts";
import type { ProgressContext, ProgressContextFactory } from "#src/progress/types.ts";
import { nullProgressContextFactory } from "#src/progress/NullProgressReporter.ts";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { IrFileAnalysisRecord } from "#src/strategies/intermediate-representation/records.ts";
import {
  createHttpMcpToolset,
  probeMcp,
  type HttpMcpToolsetConfig,
} from "./mcp/http-toolset.ts";
import { createMcpCallLogBuffer, withBudget } from "./mcp/toolset.ts";
import { listEnrichmentTargets, type EnrichmentTarget } from "./phases/list-records.ts";
import { runEnrichForRecord } from "./phases/enrich.ts";
import { saveChunkEnrichment, saveSmallEnrichment } from "./storage.ts";

export interface McpEnrichmentStrategyDeps {
  progressContextFactory?: ProgressContextFactory;
}

/** Reads the file-analysis JSON record at `file` — null on read/parse error. */
async function readPass1Record(file: string): Promise<IrFileAnalysisRecord | null> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as IrFileAnalysisRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/** Reads sibling chunks' file-analysis JSON for a big file. Returns a JSON string for the prompt. */
async function readSiblingChunksJson(
  targets: EnrichmentTarget[],
  current: EnrichmentTarget,
): Promise<string> {
  if (current.chunkNumber === undefined) {
    return "(small file — no sibling chunks)";
  }
  const siblings = targets.filter(
    (t) => t.relativePath === current.relativePath && t.chunkNumber !== current.chunkNumber,
  );
  const records: Array<{ chunkNumber: number; record: IrFileAnalysisRecord }> = [];
  for (const sib of siblings) {
    if (sib.chunkNumber === undefined) {
      continue;
    }
    const rec = await readPass1Record(sib.recordFile);
    if (rec !== null) {
      records.push({ chunkNumber: sib.chunkNumber, record: rec });
    }
  }
  if (records.length === 0) {
    return "(no sibling chunks)";
  }
  return JSON.stringify(records, null, 2);
}

/** Processes one target: reads context, runs the agent loop, writes the enrichment record. */
async function processTarget(
  target: EnrichmentTarget,
  allTargets: EnrichmentTarget[],
  input: StrategyInput,
  mcpConfig: HttpMcpToolsetConfig,
): Promise<TokenUsage> {
  const pass1 = await readPass1Record(target.recordFile);
  if (pass1 === null) {
    logger.warn(`mcp-enrichment: skipping ${target.relativePath} — file-analysis record unreadable`);
    return ZERO_USAGE;
  }
  let sourceContent: string;
  try {
    sourceContent = await input.source.readFile(target.relativePath);
  } catch (cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`mcp-enrichment: skipping ${target.relativePath} — source unreadable: ${msg}`);
    return ZERO_USAGE;
  }
  const siblingChunksJson = await readSiblingChunksJson(allTargets, target);
  const callLog = createMcpCallLogBuffer();
  const toolset = withBudget(createHttpMcpToolset(mcpConfig), callLog);

  const record = await runEnrichForRecord({
    relativePath: target.relativePath,
    ...(target.chunkNumber !== undefined ? { chunkNumber: target.chunkNumber } : {}),
    semanticAnalysisJson: JSON.stringify(pass1.analysis, null, 2),
    siblingChunksJson,
    sourceContent,
    toolset,
    callLog,
    mcpUrl: mcpConfig.url,
    ...(input.context.llmCallContext !== undefined ? { llmCallContext: input.context.llmCallContext } : {}),
  });

  if (target.chunkNumber === undefined) {
    await saveSmallEnrichment(input.metaPaths, record);
  } else {
    await saveChunkEnrichment(input.metaPaths, record);
  }
  return record.tokenUsage;
}

/**
 * Creates the `mcp-enrichment` strategy. Reads MCP config at execute time so the same factory
 * can be used in tests against a different URL.
 *
 * @param deps - Optional dependencies (progress reporter factory).
 * @returns An {@link IngestStrategy} named `"mcp-enrichment"`.
 */
export function createMcpEnrichmentStrategy(deps: McpEnrichmentStrategyDeps = {}): IngestStrategy {
  const progressContextFactory = deps.progressContextFactory ?? nullProgressContextFactory;
  return {
    name: "mcp-enrichment",
    async execute(input: StrategyInput): Promise<StrategyResult> {
      const { context, metaPaths } = input;
      const { knowledgeId } = context;
      const progressContext: ProgressContext = progressContextFactory(knowledgeId);

      try {
        const url = getConfigValue(Config.McpEnrichmentUrl);
        const authHeader = getConfigValue(Config.McpEnrichmentAuthHeader);
        const mcpConfig: HttpMcpToolsetConfig = { url };
        if (authHeader !== undefined && authHeader !== null && String(authHeader).length > 0) {
          mcpConfig.authHeader = String(authHeader);
        }
        await probeMcp(mcpConfig);

        progressContext.phaseChanged("file_analysis");
        logger.info(`mcp-enrichment: listing targets for ${knowledgeId}`);
        throwIfCancelled(knowledgeId);
        const targets = await listEnrichmentTargets(metaPaths);
        logger.info(`mcp-enrichment: ${targets.length} target(s) to enrich`);

        const llmConcurrency = getConfigValue(Config.LlmConcurrency);
        const limiter = withConcurrency(llmConcurrency);
        let usage: TokenUsage = ZERO_USAGE;
        await Promise.all(
          targets.map((target) =>
            limiter(async () => {
              throwIfCancelled(knowledgeId);
              const u = await processTarget(target, targets, input, mcpConfig);
              usage = addUsage(usage, u);
            }),
          ),
        );

        progressContext.completed();
        logger.info(
          `mcp-enrichment: done — targets=${targets.length} tokens(in/out)=${usage.inputTokens}/${usage.outputTokens} cost=$${usage.costUsd.toFixed(4)}`,
        );

        return {
          filesAnalyzed: targets.length,
          foldersSummarised: 0,
          repoSummarised: false,
          graphNodesWritten: 0,
          tokenUsage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: usage.costUsd,
          },
        };
      } catch (cause: unknown) {
        const { category, reason, detail } = classifyFailure(cause);
        progressContext.failed(reason, undefined, category, detail);
        throw cause;
      }
    },
  };
}
