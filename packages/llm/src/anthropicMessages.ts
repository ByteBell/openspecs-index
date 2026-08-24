// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { LlmError } from "@bb/errors";
import { tokenLen } from "./tokenizer.ts";
import type { AskLlmOptions, AskLlmResult } from "./client.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The Anthropic Messages wire format, used by the direct Anthropic API.
//
// Bedrock used to share this module (Anthropic-on-Bedrock accepts the same
// body), but it now speaks Converse instead — that is what makes the Bedrock
// provider family-agnostic. `supportsTemperature` still lives here because both
// providers need it and it is the one rule that spans them.
// ─────────────────────────────────────────────────────────────────────────────

/** Fallback completion cap. Anthropic requires `max_tokens` — there is no "unset". */
export const DEFAULT_MAX_COMPLETION_TOKENS = 16384;

export interface AnthropicTarget {
  /** Human label used in error messages. */
  label: string;
  url: string;
  headers: Record<string, string>;
  model: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user"; content: string }>;
  temperature?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  stop_details?: { category?: string; explanation?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Claude families that reject `temperature` / `top_p` / `top_k` with a 400 —
 * sampling params were removed API-wide on these models. Matters because the
 * skip-decision gate calls with `temperature: 0` on every scan, so sending it
 * unconditionally would hard-fail every ingest on a current Claude model.
 */
const CLAUDE_REJECTS_SAMPLING = [/opus-5/u, /opus-4-8/u, /opus-4-7/u, /sonnet-5/u, /fable-5/u, /mythos-5/u];

/**
 * The family segment of a Bedrock model reference.
 *
 * Handles all three forms operators actually configure:
 *   `anthropic.claude-…`                          bare model id
 *   `us.anthropic.claude-…`                       cross-region inference profile
 *   `arn:aws:bedrock:…:inference-profile/us.anthropic.claude-…`   profile ARN
 *
 * ARNs are unwrapped to their trailing resource id first, then the region-group
 * prefix is stripped. Missing the ARN case would reject a perfectly valid
 * inference profile — the standard way to reach cross-region capacity.
 */
function bedrockFamily(modelId: string): string {
  const resource = modelId.startsWith("arn:") ? (modelId.split("/").pop() ?? modelId) : modelId;
  return resource.replace(/^(us|eu|apac|us-gov)\./u, "");
}

/**
 * Whether this model accepts `temperature`. Two independent rules:
 *
 * - The OpenAI families **on Bedrock** reject it outright ("This model doesn't
 *   support the temperature field"), while Anthropic, Nova, Llama and Mistral
 *   take it. Matched on the family segment after any cross-region
 *   inference-profile prefix, because that prefix is part of the id operators
 *   configure.
 * - Current Claude families reject it on every platform.
 */
export function supportsTemperature(model: string): boolean {
  if (bedrockFamily(model).startsWith("openai.")) {
    return false;
  }
  return !CLAUDE_REJECTS_SAMPLING.some((rx) => rx.test(model));
}

export function resolveMaxCompletionTokens(opts: AskLlmOptions): number {
  const requested = opts.maxCompletionTokens ?? 0;
  return requested > 0 ? requested : DEFAULT_MAX_COMPLETION_TOKENS;
}

export async function anthropicMessagesCall(
  target: AnthropicTarget,
  prompt: string,
  opts: AskLlmOptions,
  timeoutMs: number,
): Promise<AskLlmResult> {
  const body: AnthropicRequest = {
    model: target.model,
    max_tokens: resolveMaxCompletionTokens(opts),
    messages: [{ role: "user", content: prompt }],
  };
  if (opts.systemPrompt !== undefined) {
    body.system = opts.systemPrompt;
  }
  // Silently drop sampling on models that 400 on it rather than failing the run.
  if (opts.temperature !== undefined && supportsTemperature(target.model)) {
    body.temperature = opts.temperature;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...target.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new LlmError(`${target.label} request timed out after ${timeoutMs}ms`, cause);
    }
    throw new LlmError(`${target.label} request failed`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LlmError(`${target.label} HTTP ${response.status}`, undefined, {
      status: response.status,
      detail: text.slice(0, 4000),
    });
  }

  const json = (await response.json()) as AnthropicResponse;

  // A safety-classifier decline is HTTP 200 with an empty `content` array.
  // Surface it as a typed error instead of "empty completion", so the operator
  // sees the actual cause.
  if (json.stop_reason === "refusal") {
    const category = json.stop_details?.category ?? "unspecified";
    throw new LlmError(`${target.label} refused the request (category: ${category})`);
  }

  // Concatenate every text block; reasoning models interleave `thinking`
  // blocks, which carry no `text` and are skipped.
  const content = (json.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text ?? "")
    .join("");

  if (content.length === 0) {
    const reason = json.stop_reason ?? "unknown";
    throw new LlmError(`${target.label} returned empty completion (stop_reason: ${reason})`);
  }

  return {
    content,
    usage: {
      model: typeof json.model === "string" && json.model.length > 0 ? json.model : target.model,
      inputTokens:
        typeof json.usage?.input_tokens === "number"
          ? json.usage.input_tokens
          : tokenLen((opts.systemPrompt ?? "") + prompt),
      outputTokens: typeof json.usage?.output_tokens === "number" ? json.usage.output_tokens : tokenLen(content),
      // Anthropic reports no per-call price. `bytebell stats` shows $0 — same
      // treatment as Ollama. Never computed client-side.
      costUsd: 0,
    },
  };
}
