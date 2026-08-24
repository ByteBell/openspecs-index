import { LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { resolveOpenRouterChain } from "./openrouter.ts";
import { resolveAnthropicChain } from "./anthropic.ts";
import { resolveBedrockChain } from "./bedrock.ts";
import { resolveGeminiChain } from "./gemini.ts";
import { resolveOpenAiChain } from "./openai.ts";
import { toolChat, type ToolChatResult } from "./toolChat.ts";
import { openRouterRawChat, type OpenRouterMessageInput, type OpenRouterToolDef } from "./openrouterChat.ts";
import type {
  AskLLMWithToolsOptions,
  AskLLMWithToolsResult,
  LoopTerminationReason,
  ToolDefinition,
  ToolInvocation,
} from "./toolTypes.ts";
import type { AskLlmOptions, AskLlmUsage, LlmProviderName } from "./client.ts";

const DEFAULT_PER_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 20_000;
const TRUNCATED_MARKER = "\n…[truncated]";

// ─────────────────────────────────────────────────────────────────────────────
// Multi-turn tool-use loop. Drives an OpenRouter-routed model through
// successive `tool_use` → `tool_result` exchanges until the model emits a
// terminal assistant message (no further tool calls). Caps and termination
// semantics: see `toolTypes.ts`.
//
// Provider scope: OpenRouter only. Ollama path stays single-shot — many open
// models served via Ollama lack the OpenAI-style `tool_calls` block, and
// validating per-model capability is the caller's problem (see the
// `EnrichmentModel` capability gate in the strategy package).
//
// Cache scope: deliberately uncached. The single-shot `askLLM` path is
// cached on (provider, prompt, systemPrompt, modelChain). Tool-use is not,
// because tool results (MCP graph queries) aren't deterministic between
// attempts — caching a prior turn's output could replay a stale graph
// view and silently change model behaviour. Resumability for partially-
// completed files is handled one level up by `enrich-files.ts` via
// `KnowledgeDoc.completedFiles[]`; if a file partially completed and the
// job retries, the loop replays from turn 1. That's an accepted cost.
// ─────────────────────────────────────────────────────────────────────────────

export async function askLLMWithTools(opts: AskLLMWithToolsOptions): Promise<AskLLMWithToolsResult> {
  // Default to the *configured* provider, not to OpenRouter. Defaulting to
  // OpenRouter made a non-OpenRouter deployment fail inside
  // `resolveOpenRouterChain` with "bytebell keys set" — an error about a key
  // the operator deliberately never set. Now the capability guard below fires
  // first and names the real problem.
  const provider: LlmProviderName = opts.provider ?? (getConfigValue(Config.LlmProvider) as LlmProviderName);
  if (!providerSupportsTools(provider)) {
    throw new LlmError(
      `askLLMWithTools: provider "${provider}" does not support tool use. ` +
        `The concept-graph strategy requires it — either run ` +
        `\`bytebell set ingestion.strategy flat-folder\`, or switch to a ` +
        `tool-capable provider.`,
    );
  }
  const subOpts = buildSubOpts(opts);
  // OpenRouter keeps its own chain resolver: it carries the key check, the
  // capped 3-model server-side chain, and its typed LlmConfigError.
  const chain = provider === "openrouter" ? resolveOpenRouterChain(subOpts) : resolveToolChain(provider, subOpts);
  const perRequestTimeoutMs = opts.perRequestTimeoutMs ?? DEFAULT_PER_REQUEST_TIMEOUT_MS;
  const maxToolResultChars = opts.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
  const toolDefs = toOpenRouterTools(opts.tools);

  const messages: OpenRouterMessageInput[] = [];
  if (opts.systemPrompt !== undefined) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: opts.prompt });

  const cumulativeUsage: AskLlmUsage = { model: chain[0] ?? "", inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const toolCalls: ToolInvocation[] = [];
  let iterations = 0;
  const startedAt = Date.now();

  while (true) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= opts.wallTimeMs) {
      return finalize(toolCalls, cumulativeUsage, iterations, "wall-time-exceeded", "");
    }
    if (iterations >= opts.maxIterations) {
      return finalize(toolCalls, cumulativeUsage, iterations, "max-iterations", "");
    }
    const remainingWallTime = opts.wallTimeMs - elapsed;
    const timeoutForThisCall = Math.min(perRequestTimeoutMs, remainingWallTime);

    // Force at least one MCP tool call by setting `tool_choice: "required"`
    // on the first turn. Without this, models like Grok and GPT-4o often
    // skip tools entirely when the prompt context already lets them emit
    // valid JSON — defeating the cross-file canonicalisation that's the
    // whole point of concept-graph enrichment. After the first tool call
    // we drop back to "auto" so the model can produce its terminal JSON
    // turn without being forced into more tool calls.
    const toolChoice = iterations === 0 && toolDefs !== undefined ? ("required" as const) : undefined;
    const chatResult = await runTurn(provider, chain, messages, subOpts, timeoutForThisCall, toolDefs, toolChoice);
    iterations += 1;
    accumulateUsage(cumulativeUsage, chatResult.usage);

    const message = chatResult.message;
    const callsInThisTurn = message.tool_calls ?? [];

    if (callsInThisTurn.length === 0) {
      const content = typeof message.content === "string" ? message.content : "";
      if (content.length === 0) {
        return finalize(toolCalls, cumulativeUsage, iterations, "empty-response", "");
      }
      return finalize(toolCalls, cumulativeUsage, iterations, "completed", content);
    }

    if (toolCalls.length + callsInThisTurn.length > opts.maxToolCalls) {
      return finalize(toolCalls, cumulativeUsage, iterations, "max-tool-calls", "");
    }

    // Append the assistant turn (carrying the tool_calls) before each tool result.
    messages.push({
      role: "assistant",
      content: typeof message.content === "string" && message.content.length > 0 ? message.content : null,
      tool_calls: callsInThisTurn,
    });

    for (const call of callsInThisTurn) {
      const parsedInput = parseToolArguments(call.function.name, call.function.arguments);
      let output: unknown;
      let toolErrored = false;
      try {
        output = await opts.executeTool(call.function.name, parsedInput);
      } catch (cause: unknown) {
        // Surface tool errors to the LLM as a tool_result payload instead of
        // killing the loop. The model can read the error and retry with
        // different arguments (e.g. fix a hallucinated path, fall back to a
        // different tool). Aborting on every tool failure made a single bad
        // model-emitted arg fatal — that's worse than letting the model
        // self-correct within its iteration budget.
        const reason = cause instanceof Error ? cause.message : String(cause);
        output = { error: reason };
        toolErrored = true;
        logger.warn(
          `llm.tool: ${call.function.name} returned error to model (iter=${iterations}/${opts.maxIterations}): ${reason.slice(0, 200)}`,
        );
      }
      const { serialised, truncated } = serialiseToolResult(output, maxToolResultChars);
      toolCalls.push({ name: call.function.name, input: parsedInput, output, outputTruncated: truncated });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: serialised,
      });
      if (!toolErrored) {
        logger.debug(
          `llm.tool: ${call.function.name} (call=${toolCalls.length}/${opts.maxToolCalls}, iter=${iterations}/${opts.maxIterations}, truncated=${truncated})`,
        );
      }
    }
  }
}

function buildSubOpts(opts: AskLLMWithToolsOptions): AskLlmOptions {
  const out: AskLlmOptions = {};
  if (opts.model !== undefined) {
    out.model = opts.model;
  }
  if (opts.fallbackModels !== undefined) {
    out.fallbackModels = opts.fallbackModels;
  }
  if (opts.apiKey !== undefined) {
    out.apiKey = opts.apiKey;
  }
  return out;
}

function toOpenRouterTools(tools: ToolDefinition[]): OpenRouterToolDef[] | undefined {
  if (tools.length === 0) {
    return undefined;
  }
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function parseToolArguments(toolName: string, raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw === "" ? "{}" : raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("arguments JSON is not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new LlmError(`tool "${toolName}" returned invalid arguments JSON: ${reason}`, cause);
  }
}

function serialiseToolResult(output: unknown, maxChars: number): { serialised: string; truncated: boolean } {
  const raw = typeof output === "string" ? output : JSON.stringify(output);
  if (raw.length <= maxChars) {
    return { serialised: raw, truncated: false };
  }
  return { serialised: raw.slice(0, maxChars - TRUNCATED_MARKER.length) + TRUNCATED_MARKER, truncated: true };
}

function accumulateUsage(acc: AskLlmUsage, next: AskLlmUsage): void {
  acc.model = next.model;
  acc.inputTokens += next.inputTokens;
  acc.outputTokens += next.outputTokens;
  acc.costUsd += next.costUsd;
}

function finalize(
  toolCalls: ToolInvocation[],
  usage: AskLlmUsage,
  iterations: number,
  terminationReason: LoopTerminationReason,
  content: string,
): AskLLMWithToolsResult {
  return { content, usage, toolCalls, iterations, terminationReason };
}

/** Providers with an OpenAI-shaped `tools` / `tool_calls` surface. */
const TOOL_CAPABLE: readonly LlmProviderName[] = ["openrouter", "anthropic", "bedrock", "gemini", "openai"];

export function providerSupportsTools(provider: LlmProviderName): boolean {
  return TOOL_CAPABLE.includes(provider);
}

/** Model chain for a non-OpenRouter tool provider — reuses each provider's own resolver. */
function resolveToolChain(provider: LlmProviderName, opts: AskLlmOptions): string[] {
  switch (provider) {
    case "anthropic":
      return resolveAnthropicChain(opts);
    case "bedrock":
      return resolveBedrockChain(opts);
    case "gemini":
      return resolveGeminiChain(opts);
    case "openai":
      return resolveOpenAiChain(opts);
    default:
      throw new LlmError(`askLLMWithTools: no chain resolver for provider "${provider}"`);
  }
}

/**
 * One turn against the active provider, in this file's message vocabulary.
 *
 * OpenRouter keeps `openRouterRawChat` because only it carries the server-side
 * `models[]` fallback chain, the `provider` routing rules, and a reported
 * `usage.cost`. Everything else goes through its OpenAI-compatible surface,
 * where only the first model in the chain is used (no server-side fan-out).
 */
async function runTurn(
  provider: LlmProviderName,
  chain: string[],
  messages: OpenRouterMessageInput[],
  opts: AskLlmOptions,
  timeoutMs: number,
  toolDefs: OpenRouterToolDef[] | undefined,
  toolChoice: "required" | undefined,
): Promise<ToolChatResult> {
  if (provider === "openrouter") {
    return openRouterRawChat(messages, chain, opts, timeoutMs, toolDefs, toolChoice);
  }
  const model = chain[0] ?? "";
  return toolChat(provider, model, messages, opts, timeoutMs, toolDefs, toolChoice);
}
