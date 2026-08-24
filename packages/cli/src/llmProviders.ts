// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the LLM backends offered at signup. The wizard
// renders from this table and `SetupCommand` writes from it, so adding a
// provider is one entry here — no branching in the Ink components and no
// second list to keep in sync.
// ─────────────────────────────────────────────────────────────────────────────

export type LlmProviderChoice = "openrouter" | "ollama" | "anthropic" | "bedrock" | "gemini" | "openai";

/**
 * The string-valued config keys a provider field may bind to. Narrower than
 * `Config` so `getConfigValue` returns `string` rather than the full value
 * union (which includes numbers and booleans).
 */
export type ProviderConfigKey =
  | Config.OpenrouterApiKey
  | Config.OpenrouterModel
  | Config.AnthropicApiKey
  | Config.AnthropicModel
  | Config.BedrockApiKey
  | Config.BedrockRegion
  | Config.BedrockModel
  | Config.GeminiApiKey
  | Config.GeminiModel
  | Config.OpenaiApiKey
  | Config.OpenaiModel
  | Config.OpenaiBaseUrl
  | Config.OllamaUrl
  | Config.OllamaModel;

export interface ProviderField {
  /** Field id, also the `KEY_MAP` key used to persist it. */
  cliKey: string;
  label: string;
  /** Config key the wizard pre-fills from (current value, else schema default). */
  configKey: ProviderConfigKey;
  mask?: boolean;
  /** Blank is never valid — every listed field is required by its provider. */
  hint: string;
}

export interface ProviderSpec {
  value: LlmProviderChoice;
  label: string;
  hint: string;
  fields: readonly ProviderField[];
  /** Whether this backend can drive `askLLMWithTools` (concept-graph strategy). */
  supportsTools: boolean;
}

export const LLM_PROVIDER_SPECS: readonly ProviderSpec[] = [
  {
    value: "openrouter",
    label: "OpenRouter",
    hint: "API key required — openrouter.ai/keys · reports real cost · supports all strategies",
    supportsTools: true,
    fields: [
      {
        cliKey: "openrouter-api-key",
        label: "API key",
        configKey: Config.OpenrouterApiKey,
        mask: true,
        hint: "sk-or-v1-…",
      },
      {
        cliKey: "openrouter-model",
        label: "Model",
        configKey: Config.OpenrouterModel,
        hint: "e.g. anthropic/claude-sonnet-5",
      },
    ],
  },
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "API key required — console.anthropic.com · Claude models direct",
    supportsTools: true,
    fields: [
      {
        cliKey: "anthropic-api-key",
        label: "API key",
        configKey: Config.AnthropicApiKey,
        mask: true,
        hint: "sk-ant-…",
      },
      { cliKey: "anthropic-model", label: "Model", configKey: Config.AnthropicModel, hint: "e.g. claude-sonnet-5" },
    ],
  },
  {
    value: "gemini",
    label: "Google Gemini",
    hint: "API key required — aistudio.google.com/apikey",
    supportsTools: true,
    fields: [
      { cliKey: "gemini-api-key", label: "API key", configKey: Config.GeminiApiKey, mask: true, hint: "AIza…" },
      { cliKey: "gemini-model", label: "Model", configKey: Config.GeminiModel, hint: "e.g. gemini-2.5-flash" },
    ],
  },
  {
    value: "openai",
    label: "OpenAI / compatible",
    hint: "API key required — platform.openai.com · or point base URL at vLLM / LiteLLM / a gateway",
    supportsTools: true,
    fields: [
      { cliKey: "openai-api-key", label: "API key", configKey: Config.OpenaiApiKey, mask: true, hint: "sk-…" },
      {
        cliKey: "openai-model",
        label: "Model",
        configKey: Config.OpenaiModel,
        hint: "exact model id from your provider",
      },
    ],
  },
  {
    value: "bedrock",
    label: "AWS Bedrock",
    hint: "API key or AWS IAM/instance role · any Bedrock model · billed to your AWS account",
    supportsTools: true,
    fields: [
      {
        cliKey: "bedrock-api-key",
        label: "Bedrock API key",
        configKey: Config.BedrockApiKey,
        mask: true,
        hint: "from the Bedrock console",
      },
      { cliKey: "bedrock-region", label: "Region", configKey: Config.BedrockRegion, hint: "e.g. us-east-1" },
      {
        cliKey: "bedrock-model",
        label: "Model id",
        configKey: Config.BedrockModel,
        // Any Bedrock family works (Converse). Ids are versioned and
        // region-dependent, so copy the exact one from the console.
        hint: "any family — copy the exact id/ARN from the Bedrock console",
      },
    ],
  },
  {
    value: "ollama",
    label: "Ollama",
    hint: "local, free, no key — daemon must already be running",
    supportsTools: false,
    fields: [
      { cliKey: "ollama-url", label: "Ollama URL", configKey: Config.OllamaUrl, hint: "http://localhost:11434" },
      { cliKey: "ollama-model", label: "Model name", configKey: Config.OllamaModel, hint: "e.g. qwen2.5-coder:7b" },
    ],
  },
];

export function providerSpec(value: LlmProviderChoice): ProviderSpec {
  const found = LLM_PROVIDER_SPECS.find((p) => p.value === value);
  if (found === undefined) {
    throw new Error(`internal: no provider spec for "${value}"`);
  }
  return found;
}

/** Pre-fill every field of every provider from the current config. */
export function initialProviderValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of LLM_PROVIDER_SPECS) {
    for (const field of spec.fields) {
      out[field.cliKey] = getConfigValue(field.configKey);
    }
  }
  return out;
}

export function providerFieldsValid(spec: ProviderSpec, values: Record<string, string>): boolean {
  return spec.fields.every((f) => (values[f.cliKey] ?? "").trim().length > 0);
}

export function maskSecret(raw: string): string {
  if (raw.length === 0) {
    return "(none)";
  }
  return `${"•".repeat(Math.min(raw.length, 8))}${raw.length > 8 ? "…" : ""}`;
}
