// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { LlmConfigError } from "@bb/errors";
import type { AskLlmOptions, AskLlmResult } from "./client.ts";
import { supportsTemperature } from "./anthropicMessages.ts";
import { walkChain } from "./attempt.ts";
import { openAiCompatibleChat, type OpenAiCompatibleTarget } from "./openaiCompatible.ts";

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";

/**
 * Endpoint base. `Config.OpenaiBaseUrl` points this at a self-hosted
 * OpenAI-compatible server (vLLM / LiteLLM / an internal gateway), which is the
 * cheapest way to reach a model this table does not name.
 */
export function openAiBase(): string {
  const configured = getConfigValue(Config.OpenaiBaseUrl);
  const base = configured.length > 0 ? configured : DEFAULT_OPENAI_BASE;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function resolveOpenAiChain(opts: AskLlmOptions): string[] {
  const apiKey = opts.apiKey ?? getConfigValue(Config.OpenaiApiKey);
  if (apiKey.length === 0) {
    throw new LlmConfigError("bytebell set openai-api-key <key>");
  }
  const primary = opts.model ?? getConfigValue(Config.OpenaiModel);
  if (primary.length === 0) {
    throw new LlmConfigError("bytebell set openai-model <model-id>");
  }
  const chain = [primary, ...(opts.fallbackModels ?? [])].map((m) => m.trim()).filter((m) => m.length > 0);
  return [...new Set(chain)];
}

/**
 * Direct OpenAI (or any OpenAI-compatible server) chat completion. No
 * server-side fallback array, so the chain is walked client-side.
 */
export async function callOpenAi(prompt: string, opts: AskLlmOptions, timeoutMs: number): Promise<AskLlmResult> {
  const chain = resolveOpenAiChain(opts);
  const apiKey = opts.apiKey ?? getConfigValue(Config.OpenaiApiKey);

  return walkChain("openai", chain, async (model) => {
    const target: OpenAiCompatibleTarget = {
      label: "OpenAI",
      url: `${openAiBase()}/chat/completions`,
      apiKey,
      allowTemperature: supportsTemperature(model),
    };
    return openAiCompatibleChat(target, model, opts, prompt, timeoutMs);
  });
}
