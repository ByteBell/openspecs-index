import { z } from "zod";
import { Config } from "@bb/types";

export { Config };

export const LOG_LEVELS = ["error", "warn", "info", "http", "verbose", "debug", "silly"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LLM_PROVIDERS = ["openrouter", "ollama"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const concurrencySchema = z
  .object({
    github: z.number().int().positive().default(2),
  })
  .strict();

export const configSchema = z
  .object({
    server_port: z.number().int().min(1).max(65535).default(8080),
    mongo_uri: z.string().default(""),
    neo4j_uri: z.string().default(""),
    neo4j_user: z.string().default(""),
    neo4j_password: z.string().default(""),
    redis_url: z.string().default(""),
    openrouter_api_key: z.string().default(""),
    openrouter_model: z.string().default("deepseek/deepseek-v4-flash"),
    openrouter_fallback_model_1: z.string().default("qwen/qwen3.5-flash-02-23"),
    openrouter_fallback_model_2: z.string().default("minimax/minimax-m2.7"),
    openrouter_fallback_model_3: z.string().default("moonshotai/kimi-k2.5"),
    openrouter_fallback_model_4: z.string().default("x-ai/grok-4.3"),
    llm_provider: z.enum(LLM_PROVIDERS).default("openrouter"),
    ollama_base_url: z.string().default("http://localhost:11434/v1"),
    ollama_model: z.string().default("llama3.1"),
    concurrency: concurrencySchema.default({ github: 2 }),
    log_level: z.enum(LOG_LEVELS).default("info"),
    log_retention_days: z.number().int().positive().default(14),
    llm_cache_enabled: z.boolean().default(true),
  })
  .strict();

export type BytebellConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: BytebellConfig = configSchema.parse({});

export type ConfigValueMap = {
  [Config.ServerPort]: number;
  [Config.MongoUri]: string;
  [Config.Neo4jUri]: string;
  [Config.Neo4jUser]: string;
  [Config.Neo4jPassword]: string;
  [Config.RedisUrl]: string;
  [Config.OpenrouterApiKey]: string;
  [Config.OpenrouterModel]: string;
  [Config.OpenrouterFallbackModel1]: string;
  [Config.OpenrouterFallbackModel2]: string;
  [Config.OpenrouterFallbackModel3]: string;
  [Config.OpenrouterFallbackModel4]: string;
  [Config.LlmProvider]: LlmProvider;
  [Config.OllamaBaseUrl]: string;
  [Config.OllamaModel]: string;
  [Config.ConcurrencyGithub]: number;
  [Config.LogLevel]: LogLevel;
  [Config.LogRetentionDays]: number;
  [Config.LlmCacheEnabled]: boolean;
};

export type ConfigValue<K extends Config> = ConfigValueMap[K];

export const REQUIRED_KEYS: readonly Config[] = [
  Config.MongoUri,
  Config.Neo4jUri,
  Config.Neo4jUser,
  Config.Neo4jPassword,
  Config.RedisUrl,
  Config.LlmProvider,
];

export const HINTS: Readonly<Record<Config, string>> = {
  [Config.ServerPort]: "bytebell set port <n>",
  [Config.MongoUri]: "bytebell set mongo <uri>",
  [Config.Neo4jUri]: "bytebell set neo4j <uri>",
  [Config.Neo4jUser]: "bytebell set neo4j-user <user>",
  [Config.Neo4jPassword]: "bytebell set neo4j-password <pwd>",
  [Config.RedisUrl]: "bytebell set redis <url>",
  [Config.OpenrouterApiKey]: "bytebell keys set",
  [Config.OpenrouterModel]: "bytebell models set <model-id>",
  [Config.OpenrouterFallbackModel1]: "bytebell set openrouter-fallback-model-1 <model-id>",
  [Config.OpenrouterFallbackModel2]: "bytebell set openrouter-fallback-model-2 <model-id>",
  [Config.OpenrouterFallbackModel3]: "bytebell set openrouter-fallback-model-3 <model-id>",
  [Config.OpenrouterFallbackModel4]: "bytebell set openrouter-fallback-model-4 <model-id>",
  [Config.LlmProvider]: "bytebell set llm-provider <openrouter|ollama>",
  [Config.OllamaBaseUrl]: "bytebell set ollama-base-url <url>",
  [Config.OllamaModel]: "bytebell set ollama-model <model-id>",
  [Config.ConcurrencyGithub]: "bytebell set concurrency.github <n>",
  [Config.LogLevel]: "bytebell set log-level <error|warn|info|debug>",
  [Config.LogRetentionDays]: "bytebell set log-retention-days <n>",
  [Config.LlmCacheEnabled]: "bytebell set llm_cache_enabled <true|false>",
};

export function readField<K extends Config>(cfg: BytebellConfig, key: K): ConfigValue<K> {
  switch (key) {
    case Config.ServerPort:
      return cfg.server_port as ConfigValue<K>;
    case Config.MongoUri:
      return cfg.mongo_uri as ConfigValue<K>;
    case Config.Neo4jUri:
      return cfg.neo4j_uri as ConfigValue<K>;
    case Config.Neo4jUser:
      return cfg.neo4j_user as ConfigValue<K>;
    case Config.Neo4jPassword:
      return cfg.neo4j_password as ConfigValue<K>;
    case Config.RedisUrl:
      return cfg.redis_url as ConfigValue<K>;
    case Config.OpenrouterApiKey:
      return cfg.openrouter_api_key as ConfigValue<K>;
    case Config.OpenrouterModel:
      return cfg.openrouter_model as ConfigValue<K>;
    case Config.OpenrouterFallbackModel1:
      return cfg.openrouter_fallback_model_1 as ConfigValue<K>;
    case Config.OpenrouterFallbackModel2:
      return cfg.openrouter_fallback_model_2 as ConfigValue<K>;
    case Config.OpenrouterFallbackModel3:
      return cfg.openrouter_fallback_model_3 as ConfigValue<K>;
    case Config.OpenrouterFallbackModel4:
      return cfg.openrouter_fallback_model_4 as ConfigValue<K>;
    case Config.LlmProvider:
      return cfg.llm_provider as ConfigValue<K>;
    case Config.OllamaBaseUrl:
      return cfg.ollama_base_url as ConfigValue<K>;
    case Config.OllamaModel:
      return cfg.ollama_model as ConfigValue<K>;
    case Config.ConcurrencyGithub:
      return cfg.concurrency.github as ConfigValue<K>;
    case Config.LogLevel:
      return cfg.log_level as ConfigValue<K>;
    case Config.LogRetentionDays:
      return cfg.log_retention_days as ConfigValue<K>;
    case Config.LlmCacheEnabled:
      return cfg.llm_cache_enabled as ConfigValue<K>;
  }
}

export function writeField<K extends Config>(cfg: BytebellConfig, key: K, value: ConfigValue<K>): BytebellConfig {
  switch (key) {
    case Config.ServerPort:
      return { ...cfg, server_port: value as number };
    case Config.MongoUri:
      return { ...cfg, mongo_uri: value as string };
    case Config.Neo4jUri:
      return { ...cfg, neo4j_uri: value as string };
    case Config.Neo4jUser:
      return { ...cfg, neo4j_user: value as string };
    case Config.Neo4jPassword:
      return { ...cfg, neo4j_password: value as string };
    case Config.RedisUrl:
      return { ...cfg, redis_url: value as string };
    case Config.OpenrouterApiKey:
      return { ...cfg, openrouter_api_key: value as string };
    case Config.OpenrouterModel:
      return { ...cfg, openrouter_model: value as string };
    case Config.OpenrouterFallbackModel1:
      return { ...cfg, openrouter_fallback_model_1: value as string };
    case Config.OpenrouterFallbackModel2:
      return { ...cfg, openrouter_fallback_model_2: value as string };
    case Config.OpenrouterFallbackModel3:
      return { ...cfg, openrouter_fallback_model_3: value as string };
    case Config.OpenrouterFallbackModel4:
      return { ...cfg, openrouter_fallback_model_4: value as string };
    case Config.LlmProvider:
      return { ...cfg, llm_provider: value as LlmProvider };
    case Config.OllamaBaseUrl:
      return { ...cfg, ollama_base_url: value as string };
    case Config.OllamaModel:
      return { ...cfg, ollama_model: value as string };
    case Config.ConcurrencyGithub:
      return { ...cfg, concurrency: { ...cfg.concurrency, github: value as number } };
    case Config.LogLevel:
      return { ...cfg, log_level: value as LogLevel };
    case Config.LogRetentionDays:
      return { ...cfg, log_retention_days: value as number };
    case Config.LlmCacheEnabled:
      return { ...cfg, llm_cache_enabled: value as boolean };
  }
}
