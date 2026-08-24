// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { LlmError } from "@bb/errors";
import { causeMessage } from "./attempt.ts";
import { tokenLen } from "./tokenizer.ts";
import type { AskLlmOptions, AskLlmResult } from "./client.ts";

// ─────────────────────────────────────────────────────────────────────────────
// One attempt against any OpenAI-shaped `/chat/completions` endpoint.
//
// OpenAI, OpenRouter, Gemini's OpenAI-compatible surface, Bedrock's
// `/openai/v1` route, and every self-hosted gateway (vLLM / LiteLLM) speak this
// wire format. The differences between them are a base URL, a bearer token, and
// which optional parameters a given model tolerates — not a request shape.
// Keeping the transport in one place is what lets a new provider be a base URL
// and a model chain rather than another hand-copied fetch with its own subtly
// different error handling.
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenAiCompatibleTarget {
  /** Provider name, used in error messages so a failure names its origin. */
  label: string;
  /** Full endpoint URL, including `/chat/completions`. */
  url: string;
  apiKey: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Some models reject `temperature` outright — see `supportsTemperature`. */
  allowTemperature?: boolean;
  /** `max_completion_tokens` on newer surfaces, `max_tokens` on OpenRouter. */
  tokenCapField?: "max_tokens" | "max_completion_tokens";
}

interface ApiResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

export async function openAiCompatibleChat(
  target: OpenAiCompatibleTarget,
  model: string,
  opts: AskLlmOptions,
  prompt: string,
  timeoutMs: number,
): Promise<AskLlmResult> {
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (opts.systemPrompt !== undefined) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const capField = target.tokenCapField ?? "max_completion_tokens";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(target.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        "Content-Type": "application/json",
        ...(target.headers ?? {}),
      },
      body: JSON.stringify({
        model,
        messages,
        ...(opts.temperature !== undefined && target.allowTemperature !== false
          ? { temperature: opts.temperature }
          : {}),
        ...(opts.maxCompletionTokens !== undefined && opts.maxCompletionTokens > 0
          ? { [capField]: opts.maxCompletionTokens }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new LlmError(`${target.label} request timed out after ${timeoutMs}ms (model=${model})`, cause);
    }
    throw new LlmError(`${target.label} request failed (model=${model}): ${causeMessage(cause)}`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LlmError(`${target.label} HTTP ${response.status} (model=${model})`, undefined, {
      status: response.status,
      detail: text.slice(0, 4000),
    });
  }

  let body: ApiResponse;
  try {
    body = (await response.json()) as ApiResponse;
  } catch (cause: unknown) {
    throw new LlmError(`${target.label} returned a non-JSON body (model=${model})`, cause);
  }

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new LlmError(`${target.label} returned empty completion (model=${model})`);
  }
  const promptText = messages.map((m) => m.content).join("\n");
  return {
    content,
    usage: {
      model,
      inputTokens: typeof body.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : tokenLen(promptText),
      outputTokens:
        typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : tokenLen(content),
      // Only OpenRouter reports a per-call price; everywhere else spend lives in
      // the operator's own provider account and is read from there.
      costUsd: typeof body.usage?.cost === "number" ? body.usage.cost : 0,
    },
  };
}
