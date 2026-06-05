import fs from "node:fs";
import {
  configSchema,
  Config,
  type BytebellConfig,
  type ConfigValue,
  HINTS,
  readField,
  writeField,
  requiredKeysFor,
} from "./schema.ts";
import { SecretSource } from "@bb/types";
import { __registerCacheInvalidator, getConfigPath, resolveUnderHome } from "./paths.ts";
import { ensureBytebellHome } from "./writer.ts";
import { getSecret, SECRET_KEYS } from "./keychain.ts";

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
  cached = overlaySecrets(configSchema.parse(parsed));
  return cached;
}

/**
 * For each secret key left empty in `config.json`, overlay the value stored in
 * the OS keychain. A non-empty plaintext value always wins (legacy / warned
 * fallback), so every downstream reader sees the resolved secret transparently.
 */
function overlaySecrets(cfg: BytebellConfig): BytebellConfig {
  let next = cfg;
  for (const key of SECRET_KEYS) {
    const current = readField(next, key);
    if (typeof current === "string" && current.length === 0) {
      const secret = getSecret(key);
      if (secret !== null && secret.length > 0) {
        next = writeField(next, key, secret as ConfigValue<typeof key>);
      }
    }
  }
  return next;
}

/**
 * Where a secret's live value comes from — see {@link SecretSource}. A non-empty
 * plaintext value in `config.json` wins (and is a security smell boot warns
 * about); otherwise the OS keychain; otherwise it is unset.
 */
export function getSecretSource(key: Config): SecretSource {
  if (readPlaintextSecret(key).length > 0) {
    return SecretSource.Plaintext;
  }
  const secret = getSecret(key);
  return secret !== null && secret.length > 0 ? SecretSource.Keychain : SecretSource.Missing;
}

/** Read a secret's raw plaintext value straight from `config.json`, bypassing the keychain overlay. */
function readPlaintextSecret(key: Config): string {
  try {
    const parsed = configSchema.parse(JSON.parse(fs.readFileSync(getConfigPath(), "utf8")));
    const value = readField(parsed, key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
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
