import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";
import { Config } from "@bb/types";
import { computeCacheKey, getCachedDecision, isCacheEnabled, recordDecision, recordHit } from "./cache.ts";
import { resolveProviderEntry } from "./providers.ts";

const DEFAULT_TIMEOUT_MS = 360_000;

export type LlmProviderName = "openrouter" | "ollama" | "anthropic" | "bedrock" | "gemini" | "openai";

export interface AskLlmOptions {
  model?: string;
  fallbackModels?: string[];
  timeoutMs?: number;
  systemPrompt?: string;
  /**
   * Per-call override of the active provider's API key. When set, takes
   * precedence over that provider's configured key (`Config.OpenrouterApiKey`,
   * `Config.AnthropicApiKey`, `Config.BedrockApiKey`, `Config.GeminiApiKey`).
   * Used by downstream consumers (e.g. the enterprise wrapper) that resolve
   * per-org credentials at the enqueue boundary and pass them through the job
   * payload. Ignored by the Ollama provider (which is keyless).
   */
  apiKey?: string;
  /**
   * Per-call override of `Config.LlmProvider`. When set, routes the call to
   * the named provider regardless of the configured default.
   */
  provider?: LlmProviderName;
  /**
   * Sampling temperature passed to the provider. Omit to use the provider's
   * default. Set to `0` for deterministic, repeatable verdicts (e.g. the
   * skip-decision yes/no gate). Part of the cache key, so changing it does
   * not return a verdict sampled at a different temperature.
   */
  temperature?: number;
  /**
   * Per-call override of the OpenRouter completion cap (provider `max_tokens`). When set, takes
   * precedence over `Config.OpenrouterMaxCompletionTokens`; `0`/undefined → the global config applies.
   * Lets a caller bound one call's output independently (e.g. the IR fan-out's per-process budget).
   */
  maxCompletionTokens?: number;
  /**
   * Per-call override of the OpenRouter reasoning ("thinking") budget (provider `reasoning.max_tokens`).
   * When set, takes precedence over `Config.OpenrouterReasoningMaxTokens`; `0` → omit (no cap sent).
   * Paired with `maxCompletionTokens` so the IR fan-out keeps visible-output headroom over thinking.
   */
  reasoningMaxTokens?: number;
  /**
   * Per-call usage observer. Invoked once for every provider resolution — both
   * fresh calls (`usage.cached !== true`) and disk-cache hits (`true`) — so a
   * consumer can meter spend progressively. Fire-and-forget: `askLLM` swallows
   * any throw so billing can never break the LLM path. Threaded via the same
   * options object as `apiKey`/`model`; absent in OSS standalone (no billing).
   */
  onUsage?: (usage: AskLlmUsage) => void;
}

export interface AskLlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Provider-reported cost in USD for this single call. Taken directly from
   * the provider's response — `usage.cost` on OpenRouter, `0` on every other
   * backend (Ollama is local; Anthropic, Bedrock, and Gemini report tokens but
   * not cost). Never computed client-side. See `LlmProviderEntry.reportsCost`.
   */
  costUsd: number;
  /**
   * `true` when this result was served from the on-disk LLM cache (no fresh
   * provider call, no new spend this run). Set by `askLLM` at its return
   * points; treat an absent value as `false`. Consumers split billable
   * ("fresh") from non-billable ("cached") token usage on this flag.
   */
  cached?: boolean;
}

export interface AskLlmResult {
  content: string;
  usage: AskLlmUsage;
}

export async function askLLM(prompt: string, opts: AskLlmOptions = {}): Promise<AskLlmResult> {
  const provider: LlmProviderName = opts.provider ?? (getConfigValue(Config.LlmProvider) as LlmProviderName);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const entry = resolveProviderEntry(provider);
  const chain = entry.resolveChain(opts);

  const cacheOn = isCacheEnabled();
  const cacheKey = cacheOn
    ? computeCacheKey({
        provider,
        prompt,
        systemPrompt: opts.systemPrompt ?? null,
        modelChain: chain,
        temperature: opts.temperature ?? null,
      })
    : null;
  if (cacheOn && cacheKey !== null) {
    const cached = await getCachedDecision(cacheKey);
    if (cached !== null) {
      const saved = cached.usage.inputTokens + cached.usage.outputTokens;
      logger.debug(`llm: cache hit (key=${cacheKey.slice(0, 8)}, tokens-saved=${saved})`);
      void recordHit(cacheKey);
      const hitUsage = { ...cached.usage, cached: true };
      notifyUsage(opts, hitUsage);
      return { content: cached.content, usage: hitUsage };
    }
    logger.debug(`llm: cache miss (key=${cacheKey.slice(0, 8)})`);
  }

  const result = await entry.call(prompt, opts, timeoutMs);

  if (cacheOn && cacheKey !== null) {
    void recordDecision(cacheKey, {
      content: result.content,
      usage: result.usage,
      modelChain: chain,
    });
  }
  const freshUsage = { ...result.usage, cached: false };
  notifyUsage(opts, freshUsage);
  return { ...result, usage: freshUsage };
}

/** Fire the per-call usage observer, swallowing any error — billing must never break the LLM path. */
function notifyUsage(opts: AskLlmOptions, usage: AskLlmUsage): void {
  if (opts.onUsage === undefined) {
    return;
  }
  try {
    opts.onUsage(usage);
  } catch (err) {
    logger.debug(`llm: onUsage observer threw (ignored): ${err instanceof Error ? err.message : String(err)}`);
  }
}
