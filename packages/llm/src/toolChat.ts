// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import OpenAI from "openai";
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { LlmConfigError, LlmError } from "@bb/errors";
import { tokenLen } from "./tokenizer.ts";
import type { AskLlmOptions, AskLlmUsage, LlmProviderName } from "./client.ts";
import { supportsTemperature } from "./anthropicMessages.ts";
import { causeMessage } from "./attempt.ts";
import { openAiBase } from "./openai.ts";
import type { OpenRouterMessageInput, OpenRouterToolCall, OpenRouterToolDef } from "./openrouterChat.ts";

// ─────────────────────────────────────────────────────────────────────────────
// One tool-capable chat turn, on whichever provider the deployment runs.
//
// Tool use used to be OpenRouter-only, and off OpenRouter the loop simply threw
// — which meant the `concept-graph` strategy silently became unavailable the
// moment an operator switched backend. That is not a provider switch; it is a
// feature disappearing. So this dispatches instead.
//
// Every provider below exposes an **OpenAI-shaped `tools` / `tool_calls`
// surface**, which is why the non-OpenRouter branch is one shared client call
// rather than four more request builders. OpenRouter keeps its own path
// (`openRouterRawChat`) because it alone carries the server-side `models[]`
// fallback chain, the `provider` routing rules, and a reported `usage.cost`.
// ─────────────────────────────────────────────────────────────────────────────

/** OpenAI-compatible base URL per provider. */
function baseUrlFor(provider: LlmProviderName): string {
  switch (provider) {
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai/";
    case "anthropic":
      // Anthropic publishes an OpenAI-compatible layer on the same host.
      return "https://api.anthropic.com/v1/";
    case "bedrock": {
      const region = getConfigValue(Config.BedrockRegion);
      if (region.length === 0) {
        throw new LlmConfigError("bytebell set bedrock-region <region>");
      }
      // `bedrock.ts` calls Converse through the AI SDK, which covers every model
      // family but exposes no OpenAI-shaped `tool_calls` block. AWS publishes
      // `/openai/v1` on the same host, which does — and takes the Bedrock API
      // key as a plain bearer token.
      return `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`;
    }
    case "openai":
      return openAiBase();
    default:
      throw new LlmError(`toolChat: provider "${provider}" has no OpenAI-compatible surface`);
  }
}

/** The bearer credential for a provider's OpenAI-compatible surface. */
function apiKeyFor(provider: LlmProviderName, opts: AskLlmOptions): string {
  if (opts.apiKey !== undefined && opts.apiKey.length > 0) {
    return opts.apiKey;
  }
  switch (provider) {
    case "gemini":
      return requireKey(getConfigValue(Config.GeminiApiKey), "bytebell set gemini-api-key <key>");
    case "anthropic":
      return requireKey(getConfigValue(Config.AnthropicApiKey), "bytebell set anthropic-api-key <key>");
    case "bedrock":
      // The OpenAI-compatible route is bearer-authenticated — SigV4 does not
      // apply here, so tool use on Bedrock needs the API key specifically.
      return requireKey(
        getConfigValue(Config.BedrockApiKey),
        "bytebell set bedrock-api-key <key> — Bedrock tool use requires the bearer API key (SigV4 is not supported on the OpenAI-compatible route)",
      );
    case "openai":
      return requireKey(getConfigValue(Config.OpenaiApiKey), "bytebell set openai-api-key <key>");
    default:
      throw new LlmError(`toolChat: provider "${provider}" has no credential mapping`);
  }
}

function requireKey(value: string, hint: string): string {
  if (value.length === 0) {
    throw new LlmConfigError(hint);
  }
  return value;
}

// One cached client per (provider, key-prefix, base) — never keyed on the secret.
const clients = new Map<string, OpenAI>();

function clientFor(provider: LlmProviderName, opts: AskLlmOptions): OpenAI {
  const apiKey = apiKeyFor(provider, opts);
  const baseURL = baseUrlFor(provider);
  const cacheKey = `${provider}|${baseURL}|${apiKey.slice(0, 8)}`;
  const existing = clients.get(cacheKey);
  if (existing !== undefined) {
    return existing;
  }
  const client = new OpenAI({ apiKey, baseURL });
  clients.set(cacheKey, client);
  return client;
}

export interface ToolChatResult {
  message: OpenRouterMessageInput & { tool_calls?: OpenRouterToolCall[] };
  usage: AskLlmUsage;
  finishReason: string | null;
}

/**
 * One tool turn against a non-OpenRouter provider.
 *
 * `OpenRouterMessageInput` and `OpenRouterToolDef` are structurally the OpenAI
 * shapes — same roles, same `tool_calls` / `tool_call_id` fields — so the
 * conversion is a cast at the boundary rather than a rewrite.
 */
export async function toolChat(
  provider: LlmProviderName,
  model: string,
  messages: OpenRouterMessageInput[],
  opts: AskLlmOptions,
  timeoutMs: number,
  tools?: OpenRouterToolDef[],
  toolChoice?: "auto" | "required",
): Promise<ToolChatResult> {
  const client = clientFor(provider, opts);

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        ...(tools !== undefined && tools.length > 0
          ? {
              tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
              tool_choice: toolChoice ?? "auto",
            }
          : {}),
        ...(opts.temperature !== undefined && supportsTemperature(model) ? { temperature: opts.temperature } : {}),
        ...(opts.maxCompletionTokens !== undefined && opts.maxCompletionTokens > 0
          ? { max_completion_tokens: opts.maxCompletionTokens }
          : {}),
      },
      { timeout: timeoutMs },
    );

    const choice = completion.choices[0];
    if (choice === undefined) {
      throw new LlmError(`${provider} returned no choices (model=${model})`);
    }
    const promptText = messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter((t) => t.length > 0)
      .join("\n");

    return {
      message: choice.message as unknown as OpenRouterMessageInput & { tool_calls?: OpenRouterToolCall[] },
      finishReason: choice.finish_reason ?? null,
      usage: {
        model: completion.model.length > 0 ? completion.model : model,
        inputTokens: completion.usage?.prompt_tokens ?? tokenLen(promptText),
        outputTokens: completion.usage?.completion_tokens ?? tokenLen(choice.message.content ?? ""),
        // Only OpenRouter reports a per-call price.
        costUsd: 0,
      },
    };
  } catch (cause: unknown) {
    throw cause instanceof LlmError || cause instanceof LlmConfigError
      ? cause
      : new LlmError(`${provider} tool turn failed (model=${model}): ${causeMessage(cause)}`, cause);
  }
}
