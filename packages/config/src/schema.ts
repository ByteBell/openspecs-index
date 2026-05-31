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
    concurrency: concurrencySchema.default({ github: 2 }),
    log_level: z.enum(LOG_LEVELS).default("info"),
    log_retention_days: z.number().int().positive().default(14),
    llm_cache_enabled: z.boolean().default(true),
    llm_provider: z.enum(LLM_PROVIDERS).default("openrouter"),
    ollama_url: z.string().default("http://localhost:11434"),
    ollama_model: z.string().default(""),
    "context.window.limit": z.number().int().positive().default(15000),
    "max.tokens.per.chunk": z.number().int().positive().default(6000),
    "big.file.concurrency": z.number().int().positive().default(25),
    "absolute.file.size.cap": z.number().int().positive().default(52428800),
    "concurrent.workers": z.number().int().positive().default(4),
    "llm.concurrency": z.number().int().positive().default(29),
    "folder.summary.batch.size": z.number().int().positive().default(10),
    "folder.summary.batch.max.files": z.number().int().positive().default(15),
    "neo4j.batch.size": z.number().int().positive().default(50),
    "condense.context.limit": z.number().int().positive().default(12000),
    "condense.prompt.overhead": z.number().int().nonnegative().default(1500),
    "small.file.dedup.threshold": z.number().int().positive().default(3),
    "big.file.line.threshold": z.number().int().positive().default(2000),
    org_id: z.string().default("local"),
    "skip.decision.enabled": z.boolean().default(true),
    "skip.decision.max.chars.for.llm": z.number().int().positive().default(4000),
    "skip.decision.cache.path": z.string().default(""),
    "mcp_enrichment.url": z.string().default(""),
    "mcp_enrichment.auth_header": z.string().default(""),
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
  [Config.ConcurrencyGithub]: number;
  [Config.LogLevel]: LogLevel;
  [Config.LogRetentionDays]: number;
  [Config.LlmCacheEnabled]: boolean;
  [Config.LlmProvider]: LlmProvider;
  [Config.OllamaUrl]: string;
  [Config.OllamaModel]: string;
  [Config.ContextWindowLimit]: number;
  [Config.MaxTokensPerChunk]: number;
  [Config.BigFileConcurrency]: number;
  [Config.AbsoluteFileSizeCap]: number;
  [Config.ConcurrentWorkers]: number;
  [Config.LlmConcurrency]: number;
  [Config.FolderSummaryBatchSize]: number;
  [Config.FolderSummaryBatchMaxFiles]: number;
  [Config.Neo4jBatchSize]: number;
  [Config.CondenseContextLimit]: number;
  [Config.CondensePromptOverhead]: number;
  [Config.SmallFileDedupThreshold]: number;
  [Config.BigFileLineThreshold]: number;
  [Config.OrgId]: string;
  [Config.SkipDecisionEnabled]: boolean;
  [Config.SkipDecisionMaxCharsForLlm]: number;
  [Config.SkipDecisionCachePath]: string;
  [Config.McpEnrichmentUrl]: string;
  [Config.McpEnrichmentAuthHeader]: string;
};

export type ConfigValue<K extends Config> = ConfigValueMap[K];

export const REQUIRED_KEYS: readonly Config[] = [
  Config.MongoUri,
  Config.Neo4jUri,
  Config.Neo4jUser,
  Config.Neo4jPassword,
  Config.RedisUrl,
];

const PROVIDER_REQUIRED_KEYS: Readonly<Record<LlmProvider, readonly Config[]>> = {
  openrouter: [Config.OpenrouterApiKey],
  ollama: [Config.OllamaUrl, Config.OllamaModel],
};

export function requiredKeysFor(provider: LlmProvider): readonly Config[] {
  return [...REQUIRED_KEYS, ...PROVIDER_REQUIRED_KEYS[provider]];
}

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
  [Config.ConcurrencyGithub]: "bytebell set concurrency.github <n>",
  [Config.LogLevel]: "bytebell set log-level <error|warn|info|debug>",
  [Config.LogRetentionDays]: "bytebell set log-retention-days <n>",
  [Config.LlmCacheEnabled]: "bytebell set llm_cache_enabled <true|false>",
  [Config.LlmProvider]: "bytebell set llm-provider <openrouter|ollama>",
  [Config.OllamaUrl]: "bytebell set ollama-url <url>",
  [Config.OllamaModel]: "bytebell set ollama-model <model>",
  [Config.ContextWindowLimit]: "bytebell set context.window.limit <n>",
  [Config.MaxTokensPerChunk]: "bytebell set max.tokens.per.chunk <n>",
  [Config.BigFileConcurrency]: "bytebell set big.file.concurrency <n>",
  [Config.AbsoluteFileSizeCap]: "bytebell set absolute.file.size.cap <bytes>",
  [Config.ConcurrentWorkers]: "bytebell set concurrent.workers <n>",
  [Config.LlmConcurrency]: "bytebell set llm.concurrency <n>",
  [Config.FolderSummaryBatchSize]: "bytebell set folder.summary.batch.size <n>",
  [Config.FolderSummaryBatchMaxFiles]: "bytebell set folder.summary.batch.max.files <n>",
  [Config.Neo4jBatchSize]: "bytebell set neo4j.batch.size <n>",
  [Config.CondenseContextLimit]: "bytebell set condense.context.limit <n>",
  [Config.CondensePromptOverhead]: "bytebell set condense.prompt.overhead <n>",
  [Config.SmallFileDedupThreshold]: "bytebell set small.file.dedup.threshold <n>",
  [Config.BigFileLineThreshold]: "bytebell set big.file.line.threshold <n>",
  [Config.OrgId]: "bytebell set org_id <value>",
  [Config.SkipDecisionEnabled]: "bytebell set skip.decision.enabled <true|false>",
  [Config.SkipDecisionMaxCharsForLlm]: "bytebell set skip.decision.max.chars.for.llm <n>",
  [Config.SkipDecisionCachePath]: "bytebell set skip.decision.cache.path <path>",
  [Config.McpEnrichmentUrl]: "bytebell set mcp_enrichment.url <url>",
  [Config.McpEnrichmentAuthHeader]: "bytebell set mcp_enrichment.auth_header <header>",
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
    case Config.ConcurrencyGithub:
      return cfg.concurrency.github as ConfigValue<K>;
    case Config.LogLevel:
      return cfg.log_level as ConfigValue<K>;
    case Config.LogRetentionDays:
      return cfg.log_retention_days as ConfigValue<K>;
    case Config.LlmCacheEnabled:
      return cfg.llm_cache_enabled as ConfigValue<K>;
    case Config.LlmProvider:
      return cfg.llm_provider as ConfigValue<K>;
    case Config.OllamaUrl:
      return cfg.ollama_url as ConfigValue<K>;
    case Config.OllamaModel:
      return cfg.ollama_model as ConfigValue<K>;
    case Config.ContextWindowLimit:
      return cfg["context.window.limit"] as ConfigValue<K>;
    case Config.MaxTokensPerChunk:
      return cfg["max.tokens.per.chunk"] as ConfigValue<K>;
    case Config.BigFileConcurrency:
      return cfg["big.file.concurrency"] as ConfigValue<K>;
    case Config.AbsoluteFileSizeCap:
      return cfg["absolute.file.size.cap"] as ConfigValue<K>;
    case Config.ConcurrentWorkers:
      return cfg["concurrent.workers"] as ConfigValue<K>;
    case Config.LlmConcurrency:
      return cfg["llm.concurrency"] as ConfigValue<K>;
    case Config.FolderSummaryBatchSize:
      return cfg["folder.summary.batch.size"] as ConfigValue<K>;
    case Config.FolderSummaryBatchMaxFiles:
      return cfg["folder.summary.batch.max.files"] as ConfigValue<K>;
    case Config.Neo4jBatchSize:
      return cfg["neo4j.batch.size"] as ConfigValue<K>;
    case Config.CondenseContextLimit:
      return cfg["condense.context.limit"] as ConfigValue<K>;
    case Config.CondensePromptOverhead:
      return cfg["condense.prompt.overhead"] as ConfigValue<K>;
    case Config.SmallFileDedupThreshold:
      return cfg["small.file.dedup.threshold"] as ConfigValue<K>;
    case Config.BigFileLineThreshold:
      return cfg["big.file.line.threshold"] as ConfigValue<K>;
    case Config.OrgId:
      return cfg.org_id as ConfigValue<K>;
    case Config.SkipDecisionEnabled:
      return cfg["skip.decision.enabled"] as ConfigValue<K>;
    case Config.SkipDecisionMaxCharsForLlm:
      return cfg["skip.decision.max.chars.for.llm"] as ConfigValue<K>;
    case Config.SkipDecisionCachePath:
      return cfg["skip.decision.cache.path"] as ConfigValue<K>;
    case Config.McpEnrichmentUrl:
      return cfg["mcp_enrichment.url"] as ConfigValue<K>;
    case Config.McpEnrichmentAuthHeader:
      return cfg["mcp_enrichment.auth_header"] as ConfigValue<K>;
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
    case Config.ConcurrencyGithub:
      return { ...cfg, concurrency: { ...cfg.concurrency, github: value as number } };
    case Config.LogLevel:
      return { ...cfg, log_level: value as LogLevel };
    case Config.LogRetentionDays:
      return { ...cfg, log_retention_days: value as number };
    case Config.LlmCacheEnabled:
      return { ...cfg, llm_cache_enabled: value as boolean };
    case Config.LlmProvider:
      return { ...cfg, llm_provider: value as LlmProvider };
    case Config.OllamaUrl:
      return { ...cfg, ollama_url: value as string };
    case Config.OllamaModel:
      return { ...cfg, ollama_model: value as string };
    case Config.ContextWindowLimit:
      return { ...cfg, "context.window.limit": value as number };
    case Config.MaxTokensPerChunk:
      return { ...cfg, "max.tokens.per.chunk": value as number };
    case Config.BigFileConcurrency:
      return { ...cfg, "big.file.concurrency": value as number };
    case Config.AbsoluteFileSizeCap:
      return { ...cfg, "absolute.file.size.cap": value as number };
    case Config.ConcurrentWorkers:
      return { ...cfg, "concurrent.workers": value as number };
    case Config.LlmConcurrency:
      return { ...cfg, "llm.concurrency": value as number };
    case Config.FolderSummaryBatchSize:
      return { ...cfg, "folder.summary.batch.size": value as number };
    case Config.FolderSummaryBatchMaxFiles:
      return { ...cfg, "folder.summary.batch.max.files": value as number };
    case Config.Neo4jBatchSize:
      return { ...cfg, "neo4j.batch.size": value as number };
    case Config.CondenseContextLimit:
      return { ...cfg, "condense.context.limit": value as number };
    case Config.CondensePromptOverhead:
      return { ...cfg, "condense.prompt.overhead": value as number };
    case Config.SmallFileDedupThreshold:
      return { ...cfg, "small.file.dedup.threshold": value as number };
    case Config.BigFileLineThreshold:
      return { ...cfg, "big.file.line.threshold": value as number };
    case Config.OrgId:
      throw new Error("org_id is fixed to 'local' in OSS builds and cannot be set");
    case Config.SkipDecisionEnabled:
      return { ...cfg, "skip.decision.enabled": value as boolean };
    case Config.SkipDecisionMaxCharsForLlm:
      return { ...cfg, "skip.decision.max.chars.for.llm": value as number };
    case Config.SkipDecisionCachePath:
      return { ...cfg, "skip.decision.cache.path": value as string };
    case Config.McpEnrichmentUrl:
      return { ...cfg, "mcp_enrichment.url": value as string };
    case Config.McpEnrichmentAuthHeader:
      return { ...cfg, "mcp_enrichment.auth_header": value as string };
  }
}
