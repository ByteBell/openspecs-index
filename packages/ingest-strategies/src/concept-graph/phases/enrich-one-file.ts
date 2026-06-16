import type { NodeScope } from "@bb/types";
import type { AskLlmOptions } from "@bb/llm";
import { askLLMWithTools } from "@bb/llm";
import { LlmError } from "@bb/errors";
import { retryLlmCall } from "@bb/ingest-core";
import type { FileAnalysisCache } from "@bb/ingest-core";
import { perFileEnrichmentSchema, type PerFileEnrichment } from "#src/concept-graph/enrichment-schema.ts";
import { writeEnrichmentArtifact, type EnrichmentArtifactLayout } from "#src/concept-graph/enrichment-artifact.ts";
import { buildEnrichmentToolCatalog, buildEnrichmentToolExecutor } from "#src/concept-graph/mcp-tool-executor.ts";
import { buildEnrichFileUserPrompt } from "#src/concept-graph/prompts/enrich-file.ts";
import { EnrichmentRegistry } from "#src/concept-graph/phases/enrichment-registry.ts";
import { persistEnrichment } from "#src/concept-graph/phases/persist-enrichment.ts";

export interface EnrichOneFileInput {
  file: ReturnType<FileAnalysisCache["values"]> extends IterableIterator<infer T> ? T : never;
  scope: NodeScope;
  enrichmentRunId: string;
  systemPrompt: string;
  registry: EnrichmentRegistry;
  tools: ReturnType<typeof buildEnrichmentToolCatalog>;
  executor: ReturnType<typeof buildEnrichmentToolExecutor>;
  llmCallContext?: AskLlmOptions;
  enrichmentModel: string;
  maxToolCalls: number;
  maxIterations: number;
  wallTimeMs: number;
  maxToolResultChars: number;
  layout: EnrichmentArtifactLayout;
  commitId: string;
}

export async function enrichOneFile(
  opts: EnrichOneFileInput,
): Promise<{ inputTokens: number; outputTokens: number; costUsd: number }> {
  const userPrompt = buildEnrichFileUserPrompt({
    relativePath: opts.file.relativePath,
    analysis: opts.file,
    knownConcepts: opts.registry.knownConcepts(),
    knownContracts: opts.registry.knownContracts(),
  });

  const llmOpts = {
    prompt: userPrompt,
    systemPrompt: opts.systemPrompt,
    tools: opts.tools,
    executeTool: opts.executor,
    model: opts.enrichmentModel,
    maxIterations: opts.maxIterations,
    maxToolCalls: opts.maxToolCalls,
    wallTimeMs: opts.wallTimeMs,
    maxToolResultChars: opts.maxToolResultChars,
    ...(opts.llmCallContext?.apiKey !== undefined ? { apiKey: opts.llmCallContext.apiKey } : {}),
  };

  // Wrap the tool-use loop in retryLlmCall so a single network blip during
  // the LLM round trip (or during an MCP tool result roundtrip) gets up to
  // MAX_LLM_ATTEMPTS attempts before this file is marked failed by the
  // enrichFiles batch. Cap-exhaustion (terminationReason !== "completed")
  // is treated like any other LLM failure so retry can also un-stick a
  // loop that ran out of iterations transiently.
  const result = await retryLlmCall(
    async () => {
      const r = await askLLMWithTools(llmOpts);
      if (r.terminationReason !== "completed") {
        throw new LlmError(
          `enrichment loop did not complete for ${opts.file.relativePath}: ${r.terminationReason} (iterations=${r.iterations}, toolCalls=${r.toolCalls.length})`,
        );
      }
      return r;
    },
    { phase: "enrich", unit: opts.file.relativePath },
  );
  const parsed = parseAndValidate(result.content, opts.file.relativePath);

  // Registry writes happen before the next file's prompt sees this file's
  // emissions. Map.set is atomic; "two writers propose the same entry" is a
  // tolerated semantic.
  opts.registry.recordConcepts(parsed.concepts);
  opts.registry.recordContracts(parsed.contracts);

  await persistEnrichment({
    scope: opts.scope,
    relativePath: opts.file.relativePath,
    enrichmentRunId: opts.enrichmentRunId,
    parsed,
  });

  await writeEnrichmentArtifact(opts.layout, {
    relativePath: opts.file.relativePath,
    knowledgeId: opts.scope.knowledgeId,
    commitId: opts.commitId,
    enrichmentRunId: opts.enrichmentRunId,
    enrichment: parsed,
    llmUsage: result.usage,
    iterations: result.iterations,
    toolCallCount: result.toolCalls.length,
    writtenAt: new Date().toISOString(),
  });

  return {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
  };
}

function parseAndValidate(raw: string, relativePath: string): PerFileEnrichment {
  const trimmed = stripJsonFence(raw.trim());
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmed);
  } catch (cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new LlmError(`enrichment output for ${relativePath} is not valid JSON: ${reason}`);
  }
  const result = perFileEnrichmentSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new LlmError(`enrichment output for ${relativePath} failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

function stripJsonFence(text: string): string {
  if (text.startsWith("```")) {
    const without = text.replace(/^```(?:json)?\n?/u, "").replace(/\n?```\s*$/u, "");
    return without;
  }
  return text;
}
