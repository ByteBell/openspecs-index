// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { LlmConfigError, LlmError } from "@bb/errors";
import type { AskLlmOptions, AskLlmResult } from "./client.ts";
import { anthropicMessagesCall, type AnthropicTarget } from "./anthropicMessages.ts";
import { causeMessage, walkChain } from "./attempt.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Primary model plus any caller-supplied fallbacks. The Anthropic API has no
 * server-side `models: [...]` fan-out, so the chain is walked client-side.
 */
export function resolveAnthropicChain(opts: AskLlmOptions): string[] {
  const apiKey = opts.apiKey ?? getConfigValue(Config.AnthropicApiKey);
  if (apiKey.length === 0) {
    throw new LlmConfigError("bytebell set anthropic-api-key <key>");
  }
  const primary = opts.model ?? getConfigValue(Config.AnthropicModel);
  if (primary.length === 0) {
    throw new LlmConfigError("bytebell set anthropic-model <model-id>");
  }
  const chain = [primary, ...(opts.fallbackModels ?? [])].map((m) => m.trim()).filter((m) => m.length > 0);
  return [...new Set(chain)];
}

export async function callAnthropic(prompt: string, opts: AskLlmOptions, timeoutMs: number): Promise<AskLlmResult> {
  const chain = resolveAnthropicChain(opts);
  const apiKey = opts.apiKey ?? getConfigValue(Config.AnthropicApiKey);

  return walkChain("anthropic", chain, async (model) => {
    const target: AnthropicTarget = {
      label: "Anthropic",
      url: ANTHROPIC_URL,
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      model,
    };
    try {
      return await anthropicMessagesCall(target, prompt, opts, timeoutMs);
    } catch (cause: unknown) {
      throw cause instanceof LlmError
        ? cause
        : new LlmError(`anthropic request failed (model=${model}): ${causeMessage(cause)}`, cause);
    }
  });
}
