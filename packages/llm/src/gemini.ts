// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { LlmConfigError, LlmError } from "@bb/errors";
import { tokenLen } from "./tokenizer.ts";
import type { AskLlmOptions, AskLlmResult } from "./client.ts";
import { resolveMaxCompletionTokens } from "./anthropicMessages.ts";
import { causeMessage, walkChain } from "./attempt.ts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
}

interface GeminiRequest {
  systemInstruction?: { parts: GeminiPart[] };
  contents: Array<{ role: "user"; parts: GeminiPart[] }>;
  generationConfig: { maxOutputTokens: number; temperature?: number };
}

interface GeminiResponse {
  modelVersion?: string;
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Primary model plus any caller-supplied fallbacks. Google exposes no
 * server-side fallback array, so the chain is walked client-side.
 */
export function resolveGeminiChain(opts: AskLlmOptions): string[] {
  const apiKey = opts.apiKey ?? getConfigValue(Config.GeminiApiKey);
  if (apiKey.length === 0) {
    throw new LlmConfigError("bytebell set gemini-api-key <key>");
  }
  const primary = opts.model ?? getConfigValue(Config.GeminiModel);
  if (primary.length === 0) {
    throw new LlmConfigError("bytebell set gemini-model <model-id>");
  }
  const chain = [primary, ...(opts.fallbackModels ?? [])].map((m) => m.trim()).filter((m) => m.length > 0);
  return [...new Set(chain)];
}

/** One attempt against one model. */
async function attemptGemini(
  model: string,
  prompt: string,
  opts: AskLlmOptions,
  timeoutMs: number,
): Promise<AskLlmResult> {
  const apiKey = opts.apiKey ?? getConfigValue(Config.GeminiApiKey);

  const body: GeminiRequest = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: resolveMaxCompletionTokens(opts) },
  };
  if (opts.systemPrompt !== undefined) {
    body.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
  }
  if (opts.temperature !== undefined) {
    body.generationConfig.temperature = opts.temperature;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new LlmError(`Gemini request timed out after ${timeoutMs}ms`, cause);
    }
    throw new LlmError("Gemini request failed", cause);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LlmError(`Gemini HTTP ${response.status}`, undefined, {
      status: response.status,
      detail: text.slice(0, 4000),
    });
  }

  const json = (await response.json()) as GeminiResponse;

  // A safety block is HTTP 200 with no candidates and a `blockReason`.
  const blockReason = json.promptFeedback?.blockReason;
  if (typeof blockReason === "string" && blockReason.length > 0) {
    throw new LlmError(`Gemini blocked the request (reason: ${blockReason})`);
  }

  const candidate = json.candidates?.[0];
  const content = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .filter((t) => t.length > 0)
    .join("");

  if (content.length === 0) {
    const reason = candidate?.finishReason ?? "unknown";
    throw new LlmError(`Gemini returned empty completion (finishReason: ${reason})`);
  }

  return {
    content,
    usage: {
      model: typeof json.modelVersion === "string" && json.modelVersion.length > 0 ? json.modelVersion : model,
      inputTokens:
        typeof json.usageMetadata?.promptTokenCount === "number"
          ? json.usageMetadata.promptTokenCount
          : tokenLen((opts.systemPrompt ?? "") + prompt),
      outputTokens:
        typeof json.usageMetadata?.candidatesTokenCount === "number"
          ? json.usageMetadata.candidatesTokenCount
          : tokenLen(content),
      // Gemini does not report cost. Same treatment as Ollama / Anthropic.
      costUsd: 0,
    },
  };
}

/**
 * Gemini chat completion. One attempt per model (each retried in place on a
 * transient 429 / 5xx / timeout), next model on any failure, last error
 * surfaced when the chain is dry.
 */
export async function callGemini(prompt: string, opts: AskLlmOptions, timeoutMs: number): Promise<AskLlmResult> {
  const chain = resolveGeminiChain(opts);
  return walkChain("gemini", chain, async (model) => {
    try {
      return await attemptGemini(model, prompt, opts, timeoutMs);
    } catch (cause: unknown) {
      throw cause instanceof LlmError
        ? cause
        : new LlmError(`gemini request failed (model=${model}): ${causeMessage(cause)}`, cause);
    }
  });
}
