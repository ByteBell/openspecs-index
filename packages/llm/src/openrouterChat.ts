import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { LlmError } from "@bb/errors";
import { tokenLen } from "./tokenizer.ts";
import type { AskLlmOptions, AskLlmUsage } from "./client.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ─────────────────────────────────────────────────────────────────────────────
// Lower-level OpenRouter chat — accepts arbitrary `messages[]` (including
// `assistant` and `tool` roles) and an optional `tools[]` list. Returns the
// raw assistant message so callers can dispatch on `tool_calls`. Used by
// `callOpenRouter` (single-shot wrapper preserving today's signature) and by
// the tool-use loop in `toolLoop.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenRouterToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type OpenRouterRole = "system" | "user" | "assistant" | "tool";

export interface OpenRouterMessageInput {
  role: OpenRouterRole;
  content: string | null;
  /** Set on `assistant` messages when the prior turn produced tool calls. */
  tool_calls?: OpenRouterToolCall[];
  /** Required on `tool` messages — the id of the tool_call this responds to. */
  tool_call_id?: string;
  /** Optional name on `tool` messages — the tool that produced the result. */
  name?: string;
}

interface OpenRouterUsageAccounting {
  include: true;
}

interface OpenRouterProviderRouting {
  allow_fallbacks: boolean;
  // Only route to providers that support every request parameter (tools / tool_choice /
  // response_format). Lets fallback rerouting stay safe — a fallback provider that can't do tools
  // is skipped instead of returning a 400.
  require_parameters?: boolean;
}

/**
 * OpenRouter / OpenAI-style `tool_choice` field. We restrict to the two
 * values we actually use:
 *   - `"auto"` (default when omitted): model decides whether to call tools.
 *   - `"required"`: model MUST emit at least one tool call this turn. Used
 *     by `askLLMWithTools` on the first turn so models that would otherwise
 *     skip tools (Grok, GPT-4o under some prompts) are forced to query the
 *     graph at least once.
 */
export type OpenRouterToolChoice = "auto" | "required";

interface OpenRouterRequest {
  model: string;
  models?: string[];
  messages: OpenRouterMessageInput[];
  tools?: OpenRouterToolDef[];
  tool_choice?: OpenRouterToolChoice;
  temperature?: number;
  // Hard ceiling on total completion tokens (reasoning + visible). Omitted when the config cap is 0.
  max_tokens?: number;
  // Reasoning ("thinking") token budget for reasoning models. Omitted when the config cap is 0.
  reasoning?: { max_tokens: number };
  usage: OpenRouterUsageAccounting;
  provider: OpenRouterProviderRouting;
}

interface OpenRouterResponseMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
}

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{ message?: OpenRouterResponseMessage; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

export interface OpenRouterChatResult {
  message: OpenRouterResponseMessage;
  usage: AskLlmUsage;
  finishReason: string | null;
}

export async function openRouterRawChat(
  messages: OpenRouterMessageInput[],
  modelChain: string[],
  opts: AskLlmOptions,
  timeoutMs: number,
  tools?: OpenRouterToolDef[],
  toolChoice?: OpenRouterToolChoice,
): Promise<OpenRouterChatResult> {
  const apiKey = opts.apiKey ?? getConfigValue(Config.OpenrouterApiKey);
  const model = modelChain[0] ?? opts.model ?? getConfigValue(Config.OpenrouterModel);

  const body: OpenRouterRequest = {
    model,
    messages,
    usage: { include: true },
    // Allow OpenRouter to reroute around a rate-limited/erroring provider (a 429 on one provider
    // should not hard-fail the call); `require_parameters` keeps fallback only on providers that
    // support this request's params (e.g. tools), avoiding a non-capable provider returning 400.
    provider: { allow_fallbacks: true, require_parameters: true },
  };
  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }
  if (modelChain.length > 1) {
    body.models = modelChain;
  }
  if (tools !== undefined && tools.length > 0) {
    body.tools = tools;
    // Only sent when tools are present; OpenRouter rejects `tool_choice`
    // without a corresponding `tools[]`. Default is "auto" — callers opt
    // into "required" when they want to force at least one tool call.
    if (toolChoice !== undefined) {
      body.tool_choice = toolChoice;
    }
  }
  // Bound a reasoning model's thinking budget + total output. 0 → omit (provider default, uncapped) so
  // a non-reasoning model / unconfigured deployment behaves exactly as before.
  const reasoningMaxTokens = getConfigValue(Config.OpenrouterReasoningMaxTokens);
  if (reasoningMaxTokens > 0) {
    body.reasoning = { max_tokens: reasoningMaxTokens };
  }
  // Per-call cap (opts) takes precedence over the global config — lets the IR fan-out bound each
  // process's output to its own budget. 0 → omit (provider default, uncapped).
  const maxCompletionTokens = opts.maxCompletionTokens ?? getConfigValue(Config.OpenrouterMaxCompletionTokens);
  if (maxCompletionTokens > 0) {
    body.max_tokens = maxCompletionTokens;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new LlmError(`OpenRouter request timed out after ${timeoutMs}ms`, cause);
    }
    throw new LlmError("OpenRouter request failed", cause);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LlmError(`OpenRouter HTTP ${response.status}`, undefined, {
      status: response.status,
      detail: text.slice(0, 4000),
    });
  }

  const json = (await response.json()) as OpenRouterResponse;
  const message = json.choices?.[0]?.message;
  if (message === undefined) {
    throw new LlmError("OpenRouter returned no message");
  }
  const promptText = serialiseMessagesForTokenEstimate(messages);
  return {
    message,
    finishReason: json.choices?.[0]?.finish_reason ?? null,
    usage: {
      model: typeof json.model === "string" && json.model.length > 0 ? json.model : model,
      inputTokens: typeof json.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : tokenLen(promptText),
      outputTokens:
        typeof json.usage?.completion_tokens === "number"
          ? json.usage.completion_tokens
          : tokenLen(message.content ?? ""),
      costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : 0,
    },
  };
}

function serialiseMessagesForTokenEstimate(messages: OpenRouterMessageInput[]): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter((s) => s.length > 0)
    .join("\n");
}
