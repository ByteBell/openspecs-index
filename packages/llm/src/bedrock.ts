// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { createAmazonBedrock, type AmazonBedrockProvider } from "@ai-sdk/amazon-bedrock";
import { generateText } from "ai";
import { getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import { LlmConfigError, LlmError } from "@bb/errors";
import { tokenLen } from "./tokenizer.ts";
import type { AskLlmOptions, AskLlmResult } from "./client.ts";
import { resolveMaxCompletionTokens, supportsTemperature } from "./anthropicMessages.ts";
import { causeMessage, walkChain } from "./attempt.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Amazon Bedrock via `@ai-sdk/amazon-bedrock`.
//
// This is the one provider that takes an SDK. Bedrock is not an OpenAI-shaped
// `/chat/completions` like the others: Converse has its own request shape and,
// unless a Bedrock API key is configured, SigV4-signed requests. Hand-rolling
// SigV4 is not something to get subtly wrong, and the SDK also resolves the AWS
// default credential chain — which is how a deployment on EC2/EKS authenticates
// from an instance role with no static credentials at all.
//
// Converse covers **every model family on Bedrock** (Anthropic, Nova, Llama,
// Mistral, DeepSeek, the OpenAI models) plus inference profiles and ARNs. What
// it does not normalise is which *parameters* each family accepts — see
// `supportsTemperature`.
// ─────────────────────────────────────────────────────────────────────────────

export interface BedrockAuth {
  region: string;
  /** Bearer API key — wins when set. */
  apiKey?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
}

/**
 * Auth precedence mirrors the SDK's own: a Bedrock API key wins, else static
 * SigV4 credentials when configured, else region alone so the AWS default
 * provider chain resolves the task/instance role. Passing `undefined`
 * explicitly would override that chain with nothing.
 */
export function resolveBedrockAuth(opts: AskLlmOptions): BedrockAuth {
  const region = getConfigValue(Config.BedrockRegion);
  if (region.length === 0) {
    throw new LlmConfigError("bytebell set bedrock-region <region>");
  }
  const apiKey = opts.apiKey ?? getConfigValue(Config.BedrockApiKey);
  if (apiKey.length > 0) {
    return { region, apiKey };
  }
  const accessKeyId = getConfigValue(Config.AwsAccessKeyId);
  const secretAccessKey = getConfigValue(Config.AwsSecretAccessKey);
  if (accessKeyId.length > 0 && secretAccessKey.length > 0) {
    const sessionToken = getConfigValue(Config.AwsSessionToken);
    return {
      region,
      credentials: { accessKeyId, secretAccessKey, ...(sessionToken.length > 0 ? { sessionToken } : {}) },
    };
  }
  // No static credential configured — fall through to the AWS default chain
  // (instance/task role, shared profile). If nothing resolves there the SDK
  // raises its own credential error, which `causeMessage` surfaces intact.
  return { region };
}

// One cached client per resolved credential set. Keyed by region + a short key
// prefix or the access key id — never the secret.
const clients = new Map<string, AmazonBedrockProvider>();

function clientFor(auth: BedrockAuth): AmazonBedrockProvider {
  const authKey =
    auth.apiKey !== undefined ? `key:${auth.apiKey.slice(0, 8)}` : (auth.credentials?.accessKeyId ?? "default-chain");
  const cacheKey = `${auth.region}|${authKey}`;
  const existing = clients.get(cacheKey);
  if (existing !== undefined) {
    return existing;
  }
  const client = createAmazonBedrock({
    region: auth.region,
    ...(auth.apiKey !== undefined ? { apiKey: auth.apiKey } : {}),
    ...(auth.credentials !== undefined
      ? {
          accessKeyId: auth.credentials.accessKeyId,
          secretAccessKey: auth.credentials.secretAccessKey,
          ...(auth.credentials.sessionToken !== undefined ? { sessionToken: auth.credentials.sessionToken } : {}),
        }
      : {}),
  });
  clients.set(cacheKey, client);
  return client;
}

export function resolveBedrockChain(opts: AskLlmOptions): string[] {
  resolveBedrockAuth(opts);
  const primary = opts.model ?? getConfigValue(Config.BedrockModel);
  if (primary.length === 0) {
    throw new LlmConfigError("bytebell set bedrock-model <model-id>");
  }
  const chain = [primary, ...(opts.fallbackModels ?? [])].map((m) => m.trim()).filter((m) => m.length > 0);
  return [...new Set(chain)];
}

async function attemptBedrock(
  auth: BedrockAuth,
  model: string,
  prompt: string,
  opts: AskLlmOptions,
  timeoutMs: number,
): Promise<AskLlmResult> {
  const client = clientFor(auth);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await generateText({
      model: client(model),
      ...(opts.systemPrompt !== undefined ? { system: opts.systemPrompt } : {}),
      prompt,
      // Converse normalises shape, not accepted parameters.
      ...(opts.temperature !== undefined && supportsTemperature(model) ? { temperature: opts.temperature } : {}),
      maxOutputTokens: resolveMaxCompletionTokens(opts),
      abortSignal: controller.signal,
    });

    const content = response.text;
    if (content.length === 0) {
      throw new LlmError(`Bedrock returned empty completion (model=${model})`);
    }
    return {
      content,
      usage: {
        model,
        inputTokens: response.usage.inputTokens ?? tokenLen(`${opts.systemPrompt ?? ""}${prompt}`),
        outputTokens: response.usage.outputTokens ?? tokenLen(content),
        // Bedrock reports no per-call price — spend is billed to, and read from,
        // the operator's own AWS account.
        costUsd: 0,
      },
    };
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new LlmError(`Bedrock request timed out after ${timeoutMs}ms (model=${model})`, cause);
    }
    throw cause instanceof LlmError
      ? cause
      : new LlmError(`bedrock request failed (model=${model}): ${causeMessage(cause)}`, cause);
  } finally {
    clearTimeout(timer);
  }
}

export async function callBedrock(prompt: string, opts: AskLlmOptions, timeoutMs: number): Promise<AskLlmResult> {
  const auth = resolveBedrockAuth(opts);
  const chain = resolveBedrockChain(opts);
  return walkChain("bedrock", chain, (model) => attemptBedrock(auth, model, prompt, opts, timeoutMs));
}
