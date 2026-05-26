import fs from "node:fs";
import {
  configSchema,
  Config,
  type BytebellConfig,
  type ConfigValue,
  HINTS,
  REQUIRED_KEYS,
  readField,
} from "./schema.ts";
import { __registerCacheInvalidator, getConfigPath } from "./paths.ts";
import { ensureBytebellHome } from "./writer.ts";

let cached: BytebellConfig | null = null;

__registerCacheInvalidator(() => {
  cached = null;
});

export function loadConfig(): BytebellConfig {
  if (cached !== null) {
    return cached;
  }
  ensureBytebellHome();
  const raw = fs.readFileSync(getConfigPath(), "utf8");
  const parsed: unknown = JSON.parse(raw);
  cached = configSchema.parse(parsed);
  return cached;
}

export function getConfigValue<K extends Config>(key: K): ConfigValue<K> {
  return readField(loadConfig(), key);
}

export type ConfigCompletenessResult = { ok: true } | { ok: false; missing: Config[]; hints: string[] };

export function isConfigComplete(): ConfigCompletenessResult {
  const cfg = loadConfig();
  const missing: Config[] = [];
  for (const key of REQUIRED_KEYS) {
    const value = readField(cfg, key);
    if (typeof value === "string" && value.length === 0) {
      missing.push(key);
    }
  }
  const llmProvider = readField(cfg, Config.LlmProvider) as string;
  if (llmProvider === "openrouter" || llmProvider.length === 0) {
    const apiKey = readField(cfg, Config.OpenrouterApiKey) as string;
    if (apiKey.length === 0) {
      missing.push(Config.OpenrouterApiKey);
    }
    const model = readField(cfg, Config.OpenrouterModel) as string;
    if (model.length === 0) {
      missing.push(Config.OpenrouterModel);
    }
  }
  if (llmProvider === "ollama") {
    const ollamaModel = readField(cfg, Config.OllamaModel) as string;
    if (ollamaModel.length === 0) {
      missing.push(Config.OllamaModel);
    }
  }
  if (missing.length === 0) {
    return { ok: true };
  }
  return { ok: false, missing, hints: missing.map((k) => HINTS[k]) };
}
