/**
 * Intermediate-representation strategy facade. Composes the per-phase modules into one
 * `IngestStrategy`. Phases run in this fixed order, each persisting its output before the next
 * starts so re-runs resume from disk:
 *
 *   1) scan       — walk + token-classify every eligible file into the scan manifest.
 *   2) analyse-small      — for every `small` entry, run one file-analysis LLM call and persist
 *                            its `FileAnalysisResult` to `fileAnalysisDir/<encoded>.json`.
 *   3) compute-boundaries — for every `big` entry, SKIM each window and LOCATE declarations;
 *                            persist `<encoded>.boundaries.json` under `bigFileAnalysisDir`.
 *   4) cut-big-files       — pure, no LLM. Read boundaries; cut chunks at declaration starts;
 *                            persist each raw chunk as `chunk-N.raw.json` (1-indexed).
 *   5) analyse-big-chunks — for every raw chunk, run the SAME file-analysis call used for small
 *                            files; persist the result as `chunk-N.json`. Each chunk record
 *                            carries the parent file's `relativePath`; chunks are NOT rolled up.
 *   6) extract-unit-sources — PURE. For every file-analysis record on disk (small + chunk),
 *                            re-project each UnitDescriptor onto its own `<safeUnit>.source.json`
 *                            under `unitAnalysisDir/<encoded>/(chunk-N/)?`. No LLM call.
 *   7) analyse-units       — one LLM call per unit source record. Persists
 *                            `<safeUnit>.analysis.json` (fingerprinted CodeUnit + accounting)
 *                            beside the source record.
 *
 * The IR strategy stops once the per-unit analysis records are on disk: no folder / repo
 * summary, no Neo4j writes, no reconstruction. Those land downstream.
 */
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import { withConcurrency } from "#src/pipeline/concurrency.ts";
import { throwIfCancelled } from "#src/pipeline/cancellation.ts";
import { classifyFailure } from "#src/pipeline/failure-classifier.ts";
import type { IngestStrategy, StrategyInput, StrategyResult } from "#src/types/strategy.ts";
import type { ProgressContext, ProgressContextFactory } from "#src/progress/types.ts";
import { nullProgressContextFactory } from "#src/progress/NullProgressReporter.ts";
import { addUsage, ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { scanAndClassify } from "./phases/scan-and-classify.ts";
import { analyseSmallFiles } from "./phases/analyse-small.ts";
import { computeBigFileBoundaries } from "./phases/compute-boundaries.ts";
import { cutBigFiles } from "./phases/cut-big-files.ts";
import { analyseBigChunks } from "./phases/analyse-big-chunks.ts";
import { extractUnitSources } from "./phases/extract-unit-sources.ts";
import { analyseUnits } from "./phases/analyse-units.ts";

export interface IrStrategyDeps {
  progressContextFactory?: ProgressContextFactory;
}

export function createIrStrategy(deps: IrStrategyDeps = {}): IngestStrategy {
  const progressContextFactory = deps.progressContextFactory ?? nullProgressContextFactory;
  return {
    name: "intermediate-representation",
    async execute(input: StrategyInput): Promise<StrategyResult> {
      const { context, source, metaPaths } = input;
      const { knowledgeId, llmCallContext, unitsLlmCallContext } = context;
      // Phase 7 model override: falls back to the main llmCallContext when unset.
      const unitsCallContext = unitsLlmCallContext ?? llmCallContext;
      const progressContext: ProgressContext = progressContextFactory(knowledgeId);
      const llmConcurrency = getConfigValue(Config.LlmConcurrency);

      try {
        // 1) scan — same shape as flat-folder, writes the canonical scan-manifest.json.
        progressContext.phaseChanged("scan");
        logger.info(`ir: phase1 (scan + classify) starting for ${knowledgeId} limit=${llmConcurrency}`);
        throwIfCancelled(knowledgeId);
        const limiter = withConcurrency(llmConcurrency);
        const scanInput: Parameters<typeof scanAndClassify>[0] = {
          knowledgeId,
          source,
          metaPaths,
          limiter,
          progressContext,
        };
        if (llmCallContext !== undefined) {
          scanInput.llmCallContext = llmCallContext;
        }
        const { manifest } = await scanAndClassify(scanInput);

        let usage: TokenUsage = ZERO_USAGE;

        // 2) analyse-small (only runs the file-analysis call for `small` entries — `big` go down
        // the boundary→cut→chunk-analyse path below).
        progressContext.phaseChanged("file_analysis");
        logger.info(
          `ir: phase2 (analyse small ${manifest.summary.smallCount}; big ${manifest.summary.bigCount} via boundary path) starting`,
        );
        throwIfCancelled(knowledgeId);
        const smallInput: Parameters<typeof analyseSmallFiles>[0] = {
          knowledgeId,
          source,
          metaPaths,
          concurrency: llmConcurrency,
          progressContext,
        };
        if (llmCallContext !== undefined) {
          smallInput.llmCallContext = llmCallContext;
        }
        const smallResult = await analyseSmallFiles(smallInput);
        usage = addUsage(usage, smallResult.tokenUsage);

        // 3) compute-boundaries — SKIM windows + locate declarations per big file.
        throwIfCancelled(knowledgeId);
        const boundariesInput: Parameters<typeof computeBigFileBoundaries>[0] = {
          knowledgeId,
          source,
          metaPaths,
          concurrency: llmConcurrency,
          progressContext,
        };
        if (llmCallContext !== undefined) {
          boundariesInput.llmCallContext = llmCallContext;
        }
        const boundariesResult = await computeBigFileBoundaries(boundariesInput);
        usage = addUsage(usage, boundariesResult.tokenUsage);

        // 4) cut-big-files — pure deterministic chunking at located boundaries (no LLM).
        throwIfCancelled(knowledgeId);
        const cutResult = await cutBigFiles({
          knowledgeId,
          source,
          metaPaths,
          concurrency: llmConcurrency,
          progressContext,
        });

        // 5) analyse-big-chunks — same file-analysis call as small files, applied per chunk.
        throwIfCancelled(knowledgeId);
        const chunkInput: Parameters<typeof analyseBigChunks>[0] = {
          knowledgeId,
          metaPaths,
          concurrency: llmConcurrency,
          progressContext,
        };
        if (llmCallContext !== undefined) {
          chunkInput.llmCallContext = llmCallContext;
        }
        const chunkResult = await analyseBigChunks(chunkInput);
        usage = addUsage(usage, chunkResult.tokenUsage);

        // 6) extract-unit-sources — PURE. Re-project every UnitDescriptor onto its own
        // <safeUnit>.source.json under unitAnalysisDir/<encoded>/(chunk-N/)?.
        throwIfCancelled(knowledgeId);
        const sourcesResult = await extractUnitSources({
          knowledgeId,
          metaPaths,
          concurrency: llmConcurrency,
          progressContext,
        });

        // 7) analyse-units — one LLM call per unit; writes <safeUnit>.analysis.json beside
        // each source record. Honors LlmConcurrency + the active llmCallContext.
        throwIfCancelled(knowledgeId);
        const unitsInput: Parameters<typeof analyseUnits>[0] = {
          knowledgeId,
          metaPaths,
          concurrency: llmConcurrency,
          progressContext,
        };
        if (unitsCallContext !== undefined) {
          unitsInput.llmCallContext = unitsCallContext;
        }
        const unitsResult = await analyseUnits(unitsInput);
        usage = addUsage(usage, unitsResult.tokenUsage);

        progressContext.completed();

        logger.info(
          `ir: done — small=${smallResult.analysed}+${smallResult.cached} ` +
            `boundaries=${boundariesResult.processed}+${boundariesResult.cached} ` +
            `cut=${cutResult.cut}+${cutResult.cached} chunks=${chunkResult.analysed}+${chunkResult.cached} ` +
            `unit-sources=${sourcesResult.extracted}+${sourcesResult.cached} ` +
            `units=${unitsResult.analysed}+${unitsResult.cached} ` +
            `tokens(in/out)=${usage.inputTokens}/${usage.outputTokens} cost=$${usage.costUsd.toFixed(4)}`,
        );

        return {
          filesAnalyzed: smallResult.analysed + smallResult.cached + cutResult.cut + cutResult.cached,
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
