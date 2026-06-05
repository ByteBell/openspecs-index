export { LOG_LEVELS, LLM_PROVIDERS, HINTS, requiredKeysFor } from "./schema.ts";
export type { BytebellConfig, ConfigValue, ConfigValueMap, LogLevel, LlmProvider } from "./schema.ts";

export {
  loadConfig,
  getConfigValue,
  isConfigComplete,
  getSecretSource,
  seedConfig,
  __isSeeded,
  __resetSeedForTests,
} from "./loader.ts";
export type { ConfigCompletenessResult } from "./loader.ts";

export { setConfigValue, ensureBytebellHome, ConfigSeededError } from "./writer.ts";

export {
  SECRET_KEYS,
  isSecretKey,
  getSecret,
  setSecret,
  deleteSecret,
  isKeychainAvailable,
  KeychainUnavailableError,
} from "./keychain.ts";
export { storeSecret } from "./secrets.ts";
export type { SecretWriteResult } from "./secrets.ts";

export {
  getBytebellHome,
  getConfigPath,
  isDevMode,
  setBytebellHomeResolver,
  __setBytebellHomeForTests,
} from "./paths.ts";
