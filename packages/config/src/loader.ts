import fs from "node:fs";
import {
  configSchema,
  Config,
  type BytebellConfig,
  type ConfigValue,
  HINTS,
  readField,
  requiredKeysFor,
} from "./schema.ts";
import { __registerCacheInvalidator, getConfigPath, resolveUnderHome } from "./paths.ts";
import { ensureBytebellHome } from "./writer.ts";

let cached: BytebellConfig | null = null;
let seeded = false;

__registerCacheInvalidator(() => {
  if (seeded) {
    return;
  }
  cached = null;
});

export function seedConfig(value: unknown): BytebellConfig {
  cached = configSchema.parse(value);
  seeded = true;
  return cached;
}

export function __isSeeded(): boolean {
  return seeded;
}

export function __resetSeedForTests(): void {
  cached = null;
  seeded = false;
}

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

/** Path-valued keys whose stored value is resolved to an absolute path on read. */
const PATH_KEYS: ReadonlySet<Config> = new Set([Config.SqlitePath, Config.LadybugPath, Config.QueueDbPath]);

export function getConfigValue<K extends Config>(key: K): ConfigValue<K> {
  const value = readField(loadConfig(), key);
  if (typeof value === "string" && PATH_KEYS.has(key)) {
    return resolveUnderHome(value) as ConfigValue<K>;
  }
  return value;
}

export type ConfigCompletenessResult = { ok: true } | { ok: false; missing: Config[]; hints: string[] };

export function isConfigComplete(): ConfigCompletenessResult {
  const cfg = loadConfig();
  const missing: Config[] = [];
  for (const key of requiredKeysFor(cfg.llm_provider)) {
    const value = readField(cfg, key);
    if (typeof value === "string" && value.length === 0) {
      missing.push(key);
    }
  }
  if (missing.length === 0) {
    return { ok: true };
  }
  return { ok: false, missing, hints: missing.map((k) => HINTS[k]) };
}
