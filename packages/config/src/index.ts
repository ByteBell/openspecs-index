export { LOG_LEVELS, LLM_PROVIDERS, HINTS } from "./schema.ts";
export type { BytebellConfig, ConfigValue, ConfigValueMap, LogLevel, LlmProvider } from "./schema.ts";

export { loadConfig, getConfigValue, isConfigComplete, seedConfig, __isSeeded, __resetSeedForTests } from "./loader.ts";
export type { ConfigCompletenessResult } from "./loader.ts";

export { setConfigValue, ensureBytebellHome, ConfigSeededError } from "./writer.ts";

export {
  getBytebellHome,
  getConfigPath,
  getApiKeyPath,
  isDevMode,
  setBytebellHomeResolver,
  __setBytebellHomeForTests,
} from "./paths.ts";
