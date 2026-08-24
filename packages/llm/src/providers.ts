// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { LlmConfigError } from "@bb/errors";
import type { AskLlmOptions, AskLlmResult, LlmProviderName } from "./client.ts";
import { callOllama, resolveOllamaChain } from "./ollama.ts";
import { callOpenRouter, resolveOpenRouterChain } from "./openrouter.ts";
import { callAnthropic, resolveAnthropicChain } from "./anthropic.ts";
import { callBedrock, resolveBedrockChain } from "./bedrock.ts";
import { callGemini, resolveGeminiChain } from "./gemini.ts";
import { callOpenAi, resolveOpenAiChain } from "./openai.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Provider dispatch table. Adding a backend is one entry here plus one module —
// `askLLM` never branches on provider identity. Mirrors the registry shape used
// by @bb/db, @bb/graph-db, and @bb/queue, minus the runtime `register` call:
// every LLM backend is in-tree and keyless to construct, so a compile-time map
// is enough and keeps the cross-cutting tier free of a connect() lifecycle.
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmProviderEntry {
  /**
   * Models this call will try, in order. Single-element for every backend
   * except OpenRouter, which has a native `models: [...]` fan-out. Also the
   * validation seam — each implementation throws `LlmConfigError` with the
   * exact `bytebell set …` hint when its credentials are missing.
   */
  resolveChain: (opts: AskLlmOptions) => string[];
  call: (prompt: string, opts: AskLlmOptions, timeoutMs: number) => Promise<AskLlmResult>;
  /** True when the backend reports real spend. Drives `bytebell stats` honesty. */
  reportsCost: boolean;
  /**
   * True when the backend can drive `askLLMWithTools` (and therefore the
   * `concept-graph` strategy). Everything except Ollama exposes an OpenAI-shaped
   * `tools` / `tool_calls` surface; Ollama stays out because tool-format support
   * varies per locally-pulled model and we cannot check it.
   */
  supportsTools: boolean;
}

export const LLM_PROVIDER_ENTRIES: Readonly<Record<LlmProviderName, LlmProviderEntry>> = {
  openrouter: {
    resolveChain: resolveOpenRouterChain,
    call: callOpenRouter,
    reportsCost: true,
    supportsTools: true,
  },
  ollama: {
    resolveChain: resolveOllamaChain,
    call: callOllama,
    reportsCost: false,
    supportsTools: false,
  },
  anthropic: {
    resolveChain: resolveAnthropicChain,
    call: callAnthropic,
    reportsCost: false,
    supportsTools: true,
  },
  bedrock: {
    resolveChain: resolveBedrockChain,
    call: callBedrock,
    reportsCost: false,
    // Tool use routes through Bedrock's OpenAI-compatible `/openai/v1` surface,
    // which is bearer-authenticated — so it needs `bedrock_api_key`, not SigV4.
    supportsTools: true,
  },
  gemini: {
    resolveChain: resolveGeminiChain,
    call: callGemini,
    reportsCost: false,
    supportsTools: true,
  },
  openai: {
    resolveChain: resolveOpenAiChain,
    call: callOpenAi,
    reportsCost: false,
    supportsTools: true,
  },
};

export const LLM_PROVIDER_NAMES: readonly LlmProviderName[] = Object.keys(LLM_PROVIDER_ENTRIES) as LlmProviderName[];

/**
 * Resolve a provider by name. Throws rather than silently falling back — a
 * typo in `llm_provider` that quietly routed every call to a different backend
 * (and a different bill) is worse than a boot failure with a precise hint.
 */
export function resolveProviderEntry(name: string): LlmProviderEntry {
  const entry = LLM_PROVIDER_ENTRIES[name as LlmProviderName];
  if (entry === undefined) {
    throw new LlmConfigError(`bytebell set llm-provider <${LLM_PROVIDER_NAMES.join("|")}>`);
  }
  return entry;
}
