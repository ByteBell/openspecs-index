import { LLM_PROVIDERS, LOG_LEVELS, setConfigValue, type LlmProvider, type LogLevel, getApiKeyPath } from "@bb/config";
import { Config } from "@bb/types";
import fs from "node:fs";

type Setter = (raw: string) => void;

export interface KeyEntry {
  configKey: Config;
  redact: boolean;
  setter: Setter;
}

function parsePositiveInt(raw: string, key: string): number {
  if (!/^-?\d+$/u.test(raw)) {
    throw new Error(`Invalid value for "${key}": expected an integer, got "${raw}"`);
  }
  const n = Number.parseInt(raw, 10);
  if (n <= 0) {
    throw new Error(`Invalid value for "${key}": expected a positive integer, got ${n}`);
  }
  return n;
}

function parsePort(raw: string): number {
  const n = parsePositiveInt(raw, "port");
  if (n > 65535) {
    throw new Error(`Invalid value for "port": ${n} is above 65535`);
  }
  return n;
}

function parseLogLevel(raw: string): LogLevel {
  const allowed: readonly string[] = LOG_LEVELS;
  if (!allowed.includes(raw)) {
    throw new Error(`Invalid value for "log-level": expected one of ${LOG_LEVELS.join(", ")}, got "${raw}"`);
  }
  return raw as LogLevel;
}

function parseLlmProvider(raw: string): LlmProvider {
  const allowed: readonly string[] = LLM_PROVIDERS;
  if (!allowed.includes(raw)) {
    throw new Error(`Invalid value for "llm-provider": expected one of ${LLM_PROVIDERS.join(", ")}, got "${raw}"`);
  }
  return raw as LlmProvider;
}

function parseBoolean(raw: string, key: string): boolean {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(`Invalid value for "${key}": expected "true" or "false", got "${raw}"`);
}

export const KEY_MAP: Record<string, KeyEntry> = {
  mongo: {
    configKey: Config.MongoUri,
    redact: false,
    setter: (s) => setConfigValue(Config.MongoUri, s),
  },
  neo4j: {
    configKey: Config.Neo4jUri,
    redact: false,
    setter: (s) => setConfigValue(Config.Neo4jUri, s),
  },
  "neo4j-user": {
    configKey: Config.Neo4jUser,
    redact: false,
    setter: (s) => setConfigValue(Config.Neo4jUser, s),
  },
  "neo4j-password": {
    configKey: Config.Neo4jPassword,
    redact: true,
    setter: (s) => setConfigValue(Config.Neo4jPassword, s),
  },
  redis: {
    configKey: Config.RedisUrl,
    redact: false,
    setter: (s) => setConfigValue(Config.RedisUrl, s),
  },
  port: {
    configKey: Config.ServerPort,
    redact: false,
    setter: (s) => setConfigValue(Config.ServerPort, parsePort(s)),
  },
  "log-level": {
    configKey: Config.LogLevel,
    redact: false,
    setter: (s) => setConfigValue(Config.LogLevel, parseLogLevel(s)),
  },
  "log-retention-days": {
    configKey: Config.LogRetentionDays,
    redact: false,
    setter: (s) => setConfigValue(Config.LogRetentionDays, parsePositiveInt(s, "log-retention-days")),
  },
  "concurrency.github": {
    configKey: Config.ConcurrencyGithub,
    redact: false,
    setter: (s) => setConfigValue(Config.ConcurrencyGithub, parsePositiveInt(s, "concurrency.github")),
  },
  "openrouter-api-key": {
    configKey: Config.OpenrouterApiKey,
    redact: true,
    setter: (s) => {
      const pemPath = getApiKeyPath();
      fs.writeFileSync(pemPath, s, { mode: 0o600 });
      setConfigValue(Config.OpenrouterApiKey, "");
    },
  },
  "openrouter-model": {
    configKey: Config.OpenrouterModel,
    redact: false,
    setter: (s) => setConfigValue(Config.OpenrouterModel, s),
  },
  "openrouter-fallback-model-1": {
    configKey: Config.OpenrouterFallbackModel1,
    redact: false,
    setter: (s) => setConfigValue(Config.OpenrouterFallbackModel1, s),
  },
  "openrouter-fallback-model-2": {
    configKey: Config.OpenrouterFallbackModel2,
    redact: false,
    setter: (s) => setConfigValue(Config.OpenrouterFallbackModel2, s),
  },
  "openrouter-fallback-model-3": {
    configKey: Config.OpenrouterFallbackModel3,
    redact: false,
    setter: (s) => setConfigValue(Config.OpenrouterFallbackModel3, s),
  },
  "openrouter-fallback-model-4": {
    configKey: Config.OpenrouterFallbackModel4,
    redact: false,
    setter: (s) => setConfigValue(Config.OpenrouterFallbackModel4, s),
  },
  llm_cache_enabled: {
    configKey: Config.LlmCacheEnabled,
    redact: false,
    setter: (s) => setConfigValue(Config.LlmCacheEnabled, parseBoolean(s, "llm_cache_enabled")),
  },
  "llm-provider": {
    configKey: Config.LlmProvider,
    redact: false,
    setter: (s) => setConfigValue(Config.LlmProvider, parseLlmProvider(s)),
  },
  "ollama-url": {
    configKey: Config.OllamaUrl,
    redact: false,
    setter: (s) => setConfigValue(Config.OllamaUrl, s),
  },
  "ollama-model": {
    configKey: Config.OllamaModel,
    redact: false,
    setter: (s) => setConfigValue(Config.OllamaModel, s),
  },
};

export function validKeysList(): string[] {
  return Object.keys(KEY_MAP);
}
