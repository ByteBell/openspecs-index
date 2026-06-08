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
import { ensureBytebellHome, setConfigValue } from "./writer.ts";
import { getSecret, setSecret, SECRET_KEYS, KeychainUnavailableError } from "./keychain.ts";

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
  const parsed = configSchema.parse(JSON.parse(raw));
  const { cfg, migrated } = resolveSecrets(parsed);
  // Persist cleared plaintext fields for migrated secrets. Each setConfigValue
  // call invalidates `cached` via __notifyConfigChanged, so we set the cache
  // *after* the persistence loop.
  for (const key of migrated) {
    setConfigValue(key, "" as ConfigValue<typeof key>);
  }
  cached = cfg;
  return cached;
}

/**
 * Resolve secrets on load: migrate any plaintext secret into the OS keychain
 * (clearing the plaintext field), and overlay keychain values into empty
 * fields. The keychain is the source of truth; plaintext only remains as the
 * stored value when no keychain backend is available on this machine.
 */
function resolveSecrets(cfg: BytebellConfig): { cfg: BytebellConfig; migrated: Config[] } {
  let next = cfg;
  const migrated: Config[] = [];
  for (const key of SECRET_KEYS) {
    const current = readField(next, key);
    if (typeof current === "string" && current.length > 0) {
      try {
        setSecret(key, current);
        // In-memory cfg keeps the value (it now lives in the keychain). The
        // plaintext field on disk is cleared by loadConfig's persist loop.
        migrated.push(key);
      } catch (err: unknown) {
        if (!(err instanceof KeychainUnavailableError)) {
          throw err;
        }
        // No keychain backend on this system — leave plaintext as the stored
        // value. The server boot warning flags it.
      }
      continue;
    }
    const secret = getSecret(key);
    if (secret !== null && secret.length > 0) {
      next = writeField(next, key, secret as ConfigValue<typeof key>);
    }
  }
  return { cfg: next, migrated };
}

/**
 * Where a secret's live value comes from — see {@link SecretSource}. After
 * `loadConfig` runs, `Plaintext` can only mean the OS keychain is unavailable
 * on this machine (so migration could not happen); otherwise the value lives
 * in the keychain or is unset.
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
  for (const key of requiredKeysFor(cfg.llm_provider, cfg.db_provider, cfg.graph_provider, cfg.queue_provider)) {
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
