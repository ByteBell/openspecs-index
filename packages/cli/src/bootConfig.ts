import { randomBytes } from "node:crypto";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { KEY_MAP } from "./keyMap.ts";

const DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017/bytebell";
const DEFAULT_NEO4J_URI = "bolt://127.0.0.1:7687";
const DEFAULT_NEO4J_USER = "neo4j";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

interface DefaultEntry {
  cliKey: string;
  configKey: Config;
  computeDefault: () => string;
}

const DEFAULTS: readonly DefaultEntry[] = [
  { cliKey: "mongo", configKey: Config.MongoUri, computeDefault: () => DEFAULT_MONGO_URI },
  { cliKey: "neo4j", configKey: Config.Neo4jUri, computeDefault: () => DEFAULT_NEO4J_URI },
  { cliKey: "neo4j-user", configKey: Config.Neo4jUser, computeDefault: () => DEFAULT_NEO4J_USER },
  { cliKey: "redis", configKey: Config.RedisUrl, computeDefault: () => DEFAULT_REDIS_URL },
  { cliKey: "neo4j-password", configKey: Config.Neo4jPassword, computeDefault: generateNeo4jPassword },
];

export interface ApplyDefaultsResult {
  written: { cliKey: string; redacted: boolean }[];
  neo4jPassword: string;
}

export function applyInfraDefaults(): ApplyDefaultsResult {
  const written: { cliKey: string; redacted: boolean }[] = [];
  for (const entry of DEFAULTS) {
    const current = readString(entry.configKey);
    if (current.length > 0) {
      continue;
    }
    const value = entry.computeDefault();
    const setter = KEY_MAP[entry.cliKey];
    if (setter === undefined) {
      throw new Error(`internal: KEY_MAP entry "${entry.cliKey}" missing`);
    }
    setter.setter(value);
    written.push({ cliKey: entry.cliKey, redacted: setter.redact });
  }
  return {
    written,
    neo4jPassword: readString(Config.Neo4jPassword),
  };
}

export interface PreflightResult {
  ok: boolean;
  missing: { configKey: Config; hintKey: string }[];
}

export function checkPreflight(): PreflightResult {
  const missing: PreflightResult["missing"] = [];
  const llmProvider = readString(Config.LlmProvider);
  if (llmProvider === "openrouter" || llmProvider.length === 0) {
    if (readString(Config.OpenrouterApiKey).length === 0) {
      missing.push({ configKey: Config.OpenrouterApiKey, hintKey: "openrouter-api-key" });
    }
    if (readString(Config.OpenrouterModel).length === 0) {
      missing.push({ configKey: Config.OpenrouterModel, hintKey: "openrouter-model" });
    }
  }
  if (llmProvider === "ollama") {
    if (readString(Config.OllamaModel).length === 0) {
      missing.push({ configKey: Config.OllamaModel, hintKey: "ollama-model" });
    }
  }
  return { ok: missing.length === 0, missing };
}

function readString(key: Config): string {
  const value = getConfigValue(key);
  return typeof value === "string" ? value : "";
}

function generateNeo4jPassword(): string {
  return randomBytes(24).toString("base64url");
}
