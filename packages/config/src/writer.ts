import fs from "node:fs";
import { configSchema, Config, type BytebellConfig, type ConfigValue, DEFAULT_CONFIG, writeField } from "./schema.ts";
import { encryptSensitiveFields } from "./crypto.ts";
import { __isSeeded } from "./loader.ts";
import { getBytebellHome, getConfigPath, __notifyConfigChanged } from "./paths.ts";

export class ConfigSeededError extends Error {
  constructor() {
    super("config cache is seeded; setConfigValue is disabled");
    this.name = "ConfigSeededError";
  }
}

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

function readConfigFile(): BytebellConfig {
  const raw = fs.readFileSync(getConfigPath(), "utf8");
  const parsed: unknown = JSON.parse(raw);
  return configSchema.parse(parsed);
}

function atomicWrite(cfg: BytebellConfig): void {
  const target = getConfigPath();
  const tmp = `${target}.tmp`;
  const encrypted = encryptSensitiveFields(cfg as Record<string, unknown>);
  const json = `${JSON.stringify(encrypted, null, 2)}\n`;
  const fd = fs.openSync(tmp, "w", FILE_MODE);
  try {
    fs.writeSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

export function ensureBytebellHome(): void {
  const home = getBytebellHome();
  fs.mkdirSync(home, { recursive: true, mode: DIR_MODE });
  if (!fs.existsSync(getConfigPath())) {
    atomicWrite(DEFAULT_CONFIG);
    return;
  }
  const raw = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")) as Record<string, unknown>;
  const expected = Object.keys(configSchema.shape);
  if (expected.some((k) => !(k in raw))) {
    atomicWrite(configSchema.parse(raw));
    __notifyConfigChanged();
  }
}

export function setConfigValue<K extends Config>(key: K, value: ConfigValue<K>): void {
  if (__isSeeded()) {
    throw new ConfigSeededError();
  }
  ensureBytebellHome();
  const current = readConfigFile();
  const next = writeField(current, key, value);
  configSchema.parse(next);
  atomicWrite(next);
  __notifyConfigChanged();
}
