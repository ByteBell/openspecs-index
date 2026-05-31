import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { tokenLen } from "./tokenizer.ts";
import type { AskLlmOptions, AskLlmResult } from "./client.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Per-attempt backoff schedule (ms). Used when a model returns an empty completion or a
 * transient transport / 5xx error — we wait, then either retry the same model (within
 * `ATTEMPTS_PER_MODEL`) or shift to the next model in the chain. Exponential so we don't
 * hammer a struggling provider, capped so a stuck call cannot hold the pool indefinitely.
 */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const ATTEMPTS_PER_MODEL = 2;

function backoffDelay(attemptIdx: number): number {
  const delay = BACKOFF_MS[Math.min(attemptIdx, BACKOFF_MS.length - 1)];
  return delay ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 16_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Errors we treat as worth retrying / shifting model for. Config errors are unrecoverable.
 * Provider-reported 4xx (other than 429) means the request itself is bad — retrying won't help.
 * EVERYTHING else (5xx, transport, empty completions, body-read failures, DOMException
 * `TimeoutError` from Bun's socket idle timer) is treated as transient and retried.
 */
function isRetryable(cause: unknown): boolean {
  if (cause instanceof LlmConfigError) {
    return false;
  }
  if (cause instanceof LlmError) {
    const status = cause.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return status === 429;
    }
    return true;
  }
  // DOMException (TimeoutError), TypeError ("fetch failed"), and other non-config errors are
  // treated as transient. The retry loop will re-try the same model up to ATTEMPTS_PER_MODEL,
  // then shift to the next fallback model. Misclassifying a permanent error as retryable just
  // means we spend a few extra fallback attempts before giving up — a cheap insurance policy.
  return true;
}

interface OpenRouterMessage {
  role: "system" | "user";
  content: string;
}

interface OpenRouterUsageAccounting {
  /**
   * Opt-in flag that asks OpenRouter to populate `usage.cost` in the
   * response with the authoritative billed cost (in USD credits). Without
   * this, OpenRouter omits the cost field.
   */
  include: true;
}

interface OpenRouterProviderRouting {
  // Pin OpenRouter to the first viable upstream provider. Without this,
  // OpenRouter silently cycles across providers on slow/failed calls and
  // we lose the per-call wall-clock budget before a real error surfaces.
  allow_fallbacks: boolean;
}

interface OpenRouterRequest {
  model: string;
  models?: string[];
  messages: OpenRouterMessage[];
  usage: OpenRouterUsageAccounting;
  provider: OpenRouterProviderRouting;
}

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
}

export function resolveOpenRouterChain(opts: AskLlmOptions): string[] {
  const apiKey = opts.apiKey ?? getConfigValue(Config.OpenrouterApiKey);
  if (apiKey.length === 0) {
    throw new LlmConfigError("bytebell keys set");
  }
  const model = opts.model ?? getConfigValue(Config.OpenrouterModel);
  const fallbackSlots = opts.fallbackModels ?? [
    getConfigValue(Config.OpenrouterFallbackModel1),
    getConfigValue(Config.OpenrouterFallbackModel2),
    getConfigValue(Config.OpenrouterFallbackModel3),
    getConfigValue(Config.OpenrouterFallbackModel4),
  ];
  const chain = [model, ...fallbackSlots].filter((m) => m.length > 0);
  // OpenRouter rejects `models: [...]` arrays with more than 3 entries (HTTP 400
  // "models array must have 3 items or fewer"). Cap the deduped chain at 3.
  return [...new Set(chain)].slice(0, 3);
}

/**
 * Single-model OpenRouter call — one fetch, no retry, no fallback. Used as the inner step of
 * {@link callOpenRouter}, which loops the resolved chain with backoff. Throws on transport
 * failure, non-OK HTTP, or an empty-completion 200 (the model returned with no content).
 */
async function callOpenRouterOnce(
  prompt: string,
  opts: AskLlmOptions,
  timeoutMs: number,
  model: string,
): Promise<AskLlmResult> {
  const apiKey = opts.apiKey ?? getConfigValue(Config.OpenrouterApiKey);

  const messages: OpenRouterMessage[] = [];
  if (opts.systemPrompt !== undefined) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const usageAccounting: OpenRouterUsageAccounting = { include: true };
  const providerRouting: OpenRouterProviderRouting = { allow_fallbacks: false };
  const body: OpenRouterRequest = { model, messages, usage: usageAccounting, provider: providerRouting };
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

  // Body read is outside the fetch try/catch above — wrap separately so a socket-level read
  // failure (Bun DOMException `TimeoutError`, parse failure on truncated JSON, etc.) becomes
  // an LlmError that the retry loop can recognise and shift models on.
  let json: OpenRouterResponse;
  try {
    json = (await response.json()) as OpenRouterResponse;
  } catch (cause: unknown) {
    throw new LlmError("OpenRouter response body read failed", cause);
  }
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new LlmError("OpenRouter returned empty completion");
  }
  return {
    content,
    usage: {
      model: typeof json.model === "string" && json.model.length > 0 ? json.model : model,
      inputTokens:
        typeof json.usage?.prompt_tokens === "number"
          ? json.usage.prompt_tokens
          : tokenLen((opts.systemPrompt ?? "") + prompt),
      outputTokens:
        typeof json.usage?.completion_tokens === "number" ? json.usage.completion_tokens : tokenLen(content),
      costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : 0,
    },
  };
}

/**
 * Calls OpenRouter walking the resolved model chain with explicit per-model retry and
 * exponential backoff. For each model, retry up to `ATTEMPTS_PER_MODEL` times on retryable
 * failures (empty completion, 5xx, 429, transport); after that, shift to the next model.
 * Config errors (auth) and non-retryable 4xx bypass the loop. The first successful call wins.
 */
export async function callOpenRouter(prompt: string, opts: AskLlmOptions, timeoutMs: number): Promise<AskLlmResult> {
  const chain = resolveOpenRouterChain(opts);
  let lastError: unknown = new LlmError("OpenRouter call failed without producing an error");
  let globalAttemptIdx = 0;

  for (let modelIdx = 0; modelIdx < chain.length; modelIdx += 1) {
    const model = chain[modelIdx];
    if (model === undefined) {
      continue;
    }
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt += 1) {
      try {
        const result = await callOpenRouterOnce(prompt, opts, timeoutMs, model);
        if (modelIdx > 0 || attempt > 0) {
          const priorAttempts = modelIdx * ATTEMPTS_PER_MODEL + attempt;
          logger.info(
            `openrouter: RECOVERED FAILURE — succeeded on ${model} after ${priorAttempts} failed attempt(s) (modelIdx=${modelIdx} attempt=${attempt + 1})`,
          );
        }
        return result;
      } catch (cause: unknown) {
        lastError = cause;
        if (!isRetryable(cause)) {
          throw cause;
        }
        const isLastTryForModel = attempt === ATTEMPTS_PER_MODEL - 1;
        const isLastModel = modelIdx === chain.length - 1;
        const moreWork = !(isLastTryForModel && isLastModel);
        const msg = cause instanceof Error ? cause.message : String(cause);
        if (moreWork) {
          const delay = backoffDelay(globalAttemptIdx);
          globalAttemptIdx += 1;
          const nextLabel = isLastTryForModel
            ? `shifting to next model ${chain[modelIdx + 1] ?? "(none)"}`
            : `retrying same model`;
          logger.warn(
            `openrouter: ${model} failed (attempt ${attempt + 1}/${ATTEMPTS_PER_MODEL}) — ${msg}; backing off ${delay}ms then ${nextLabel}`,
          );
          await sleep(delay);
        } else {
          logger.warn(`openrouter: exhausted ${chain.length} model(s) × ${ATTEMPTS_PER_MODEL} attempts — last error: ${msg}`);
        }
      }
    }
  }
  throw lastError;
}
