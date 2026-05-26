import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { LlmConfigError, LlmError } from "@bb/errors";
import { computeCacheKey, getCachedDecision, isCacheEnabled, recordDecision, recordHit } from "./cache.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 360_000;

export interface AskLlmOptions {
  model?: string;
  fallbackModels?: string[];
  timeoutMs?: number;
  systemPrompt?: string;
}

export interface AskLlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AskLlmResult {
  content: string;
  usage: AskLlmUsage;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  models?: string[];
}

interface ChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

type LlmProvider = "openrouter" | "ollama";

function resolveProvider(): LlmProvider {
  try {
    return getConfigValue(Config.LlmProvider);
  } catch {
    return "openrouter";
  }
}

function resolveEndpoint(provider: LlmProvider, baseUrl: string): string {
  if (provider === "ollama") {
    const trimmed = baseUrl.replace(/\/+$/u, "");
    return `${trimmed}/chat/completions`;
  }
  return OPENROUTER_URL;
}

function resolveHeaders(provider: LlmProvider, apiKey: string): Record<string, string> {
  if (provider === "ollama") {
    return { "Content-Type": "application/json" };
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function resolveModel(provider: LlmProvider, opts: AskLlmOptions): string {
  if (opts.model !== undefined) {
    return opts.model;
  }
  if (provider === "ollama") {
    return getConfigValue(Config.OllamaModel);
  }
  return getConfigValue(Config.OpenrouterModel);
}

function resolveFallbackChain(provider: LlmProvider, opts: AskLlmOptions): string[] {
  if (provider === "ollama") {
    return [];
  }
  const fallbackSlots = opts.fallbackModels ?? [
    getConfigValue(Config.OpenrouterFallbackModel1),
    getConfigValue(Config.OpenrouterFallbackModel2),
    getConfigValue(Config.OpenrouterFallbackModel3),
    getConfigValue(Config.OpenrouterFallbackModel4),
  ];
  return fallbackSlots.filter((m) => m.length > 0);
}

function buildModelChain(provider: LlmProvider, model: string, fallbacks: string[]): string[] {
  if (provider === "ollama") {
    return [model];
  }
  const chain = [model, ...fallbacks];
  const uniqueChain = [...new Set(chain)];
  return uniqueChain.slice(0, 3);
}

export async function askLLM(prompt: string, opts: AskLlmOptions = {}): Promise<AskLlmResult> {
  const provider = resolveProvider();

  if (provider === "openrouter") {
    const apiKey = getConfigValue(Config.OpenrouterApiKey);
    if (apiKey.length === 0) {
      throw new LlmConfigError("bytebell keys set");
    }
  }

  const model = resolveModel(provider, opts);
  const fallbacks = resolveFallbackChain(provider, opts);
  const modelChain = buildModelChain(provider, model, fallbacks);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const cacheOn = isCacheEnabled();
  const cacheKey = cacheOn
    ? computeCacheKey({
        prompt,
        systemPrompt: opts.systemPrompt ?? null,
        modelChain,
      })
    : null;
  if (cacheOn && cacheKey !== null) {
    const cached = await getCachedDecision(cacheKey);
    if (cached !== null) {
      const saved = cached.usage.inputTokens + cached.usage.outputTokens;
      console.info(`[LLM CACHE HIT] key=${cacheKey.slice(0, 8)} tokens-saved=${saved}`);
      void recordHit(cacheKey);
      return { content: cached.content, usage: cached.usage };
    }
    console.info(`[LLM CACHE MISS] key=${cacheKey.slice(0, 8)}`);
  }

  const messages: ChatMessage[] = [];
  if (opts.systemPrompt !== undefined) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const body: ChatRequest = { model, messages };
  if (provider === "openrouter" && modelChain.length > 1) {
    body.models = modelChain;
  }

  const baseUrl = getConfigValue(Config.OllamaBaseUrl);
  const endpoint = resolveEndpoint(provider, baseUrl);
  const apiKey = provider === "openrouter" ? getConfigValue(Config.OpenrouterApiKey) : "";
  const headers = resolveHeaders(provider, apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new LlmError(`${provider} request timed out after ${timeoutMs}ms`, cause);
    }
    throw new LlmError(`${provider} request failed`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LlmError(`${provider} HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const json = (await response.json()) as ChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new LlmError(`${provider} returned empty completion`);
  }
  const result: AskLlmResult = {
    content,
    usage: {
      model: typeof json.model === "string" && json.model.length > 0 ? json.model : model,
      inputTokens: typeof json.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : 0,
      outputTokens: typeof json.usage?.completion_tokens === "number" ? json.usage.completion_tokens : 0,
    },
  };
  if (cacheOn && cacheKey !== null) {
    void recordDecision(cacheKey, {
      content: result.content,
      usage: result.usage,
      modelChain,
    });
  }
  return result;
}
