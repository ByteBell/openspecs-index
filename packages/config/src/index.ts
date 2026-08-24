export { LOG_LEVELS, LLM_PROVIDERS, INFRA_MODES, HINTS, requiredKeysFor } from "./schema.ts";
export type { BytebellConfig, ConfigValue, ConfigValueMap, LogLevel, LlmProvider, InfraMode } from "./schema.ts";

export { loadConfig, getConfigValue, isConfigComplete, seedConfig, __isSeeded, __resetSeedForTests } from "./loader.ts";
export type { ConfigCompletenessResult } from "./loader.ts";

export { setConfigValue, ensureBytebellHome, ConfigSeededError } from "./writer.ts";

export {
  getBytebellHome,
  getConfigPath,
  isDevMode,
  isForceHaltOnceEnabled,
  setBytebellHomeResolver,
  __setBytebellHomeForTests,
} from "./paths.ts";
