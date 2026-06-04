import { z } from "zod";
import { Config, DbProviderType, GraphProviderType, QueueProviderType } from "@bb/types";

export { Config };

export const LOG_LEVELS = ["error", "warn", "info", "http", "verbose", "debug", "silly"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LLM_PROVIDERS = ["openrouter", "ollama"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const INGESTION_STRATEGIES = ["flat-folder", "concept-graph"] as const;
export type IngestionStrategy = (typeof INGESTION_STRATEGIES)[number];

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
    // Embedded is the default infra: SQLite + Ladybug + Honker, zero Docker and
    // no Redis. A fresh install never reaches for Mongo/Neo4j/Redis unless the
    // user explicitly switches to the Docker preset (`bytebell set …` / setup).
    db_provider: z.string().default("sqlite"),
    graph_provider: z.string().default("ladybug"),
    queue_provider: z.string().default("honker"),
    queue_db_path: z.string().default(""),
    sqlite_path: z.string().default(""),
    ladybug_path: z.string().default(""),
    "ingestion.strategy": z.enum(INGESTION_STRATEGIES).default("flat-folder"),
    "enrichment.model": z.string().default(""),
    "enrichment.max.tool.calls.per.file": z.number().int().positive().default(15),
    "enrichment.max.iterations.per.file": z.number().int().positive().default(8),
    "enrichment.wall.time.ms.per.file": z.number().int().positive().default(400000),
    "enrichment.concurrency": z.number().int().positive().default(16),
    "enrichment.max.tool.result.chars": z.number().int().positive().default(20000),
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
  [Config.DbProvider]: string;
  [Config.GraphProvider]: string;
  [Config.QueueProvider]: string;
  [Config.QueueDbPath]: string;
  [Config.SqlitePath]: string;
  [Config.LadybugPath]: string;
  [Config.IngestionStrategy]: IngestionStrategy;
  [Config.EnrichmentModel]: string;
  [Config.EnrichmentMaxToolCallsPerFile]: number;
  [Config.EnrichmentMaxIterationsPerFile]: number;
  [Config.EnrichmentWallTimeMsPerFile]: number;
  [Config.EnrichmentConcurrency]: number;
  [Config.EnrichmentMaxToolResultChars]: number;
};

export type ConfigValue<K extends Config> = ConfigValueMap[K];

const PROVIDER_REQUIRED_KEYS: Readonly<Record<LlmProvider, readonly Config[]>> = {
  openrouter: [Config.OpenrouterApiKey],
  ollama: [Config.OllamaUrl, Config.OllamaModel],
};

/** The active infra provider combo (db / graph / queue). */
export interface InfraProviders {
  db: string;
  graph: string;
  queue: string;
}

/**
 * The infra config keys the active provider combo actually requires. Embedded
 * providers (sqlite / ladybug / honker) require only their on-disk path; Docker
 * providers (mongo / neo4j / bullmq) require their connection details. This is
 * the single source of truth shared by the CLI preflight (`@bb/cli`) and the
 * server boot check (`@bb/server`) so the two can never drift — and the reason
 * an embedded install is never asked for a Redis/Mongo/Neo4j URL.
 */
export function infraRequiredKeys(infra: InfraProviders): readonly Config[] {
  const keys: Config[] = [];
  if (infra.db === DbProviderType.Mongo) {
    keys.push(Config.MongoUri);
  } else if (infra.db === DbProviderType.Sqlite) {
    keys.push(Config.SqlitePath);
  }
  if (infra.graph === GraphProviderType.Neo4j) {
    keys.push(Config.Neo4jUri, Config.Neo4jUser, Config.Neo4jPassword);
  } else if (infra.graph === GraphProviderType.Ladybug) {
    keys.push(Config.LadybugPath);
  }
  if (infra.queue === QueueProviderType.Bullmq) {
    keys.push(Config.RedisUrl);
  } else if (infra.queue === QueueProviderType.Honker) {
    keys.push(Config.QueueDbPath);
  }
  return keys;
}

export function requiredKeysFor(provider: LlmProvider, infra: InfraProviders): readonly Config[] {
  return [...infraRequiredKeys(infra), ...PROVIDER_REQUIRED_KEYS[provider]];
}

/**
 * One-time upgrade reconciliation for configs written before embedded became the
 * default. A pre-existing Docker install has `mongo_uri` / `neo4j_uri` /
 * `redis_url` set on disk but no `db_provider` / `graph_provider` /
 * `queue_provider` keys (those were read-time defaults, or — for the queue —
 * did not exist yet). Left untouched, the absent keys now default to the
 * embedded combo (sqlite / ladybug / honker), so the server would silently boot
 * against empty embedded stores and orphan the user's populated Mongo/Neo4j.
 *
 * So: when a provider key is ABSENT from the raw on-disk config and its matching
 * Docker connection key is present and non-empty, pin the provider to the Docker
 * value. Keys the user set explicitly are never touched, and a fresh install
 * (no connection keys) keeps the embedded default. Mutates `raw` in place;
 * returns true if anything was pinned (so the caller knows to persist).
 */
export function pinLegacyInfraProviders(raw: Record<string, unknown>): boolean {
  const hasValue = (key: Config): boolean => typeof raw[key] === "string" && (raw[key] as string).length > 0;
  let pinned = false;
  if (!(Config.DbProvider in raw) && hasValue(Config.MongoUri)) {
    raw[Config.DbProvider] = DbProviderType.Mongo;
    pinned = true;
  }
  if (!(Config.GraphProvider in raw) && hasValue(Config.Neo4jUri)) {
    raw[Config.GraphProvider] = GraphProviderType.Neo4j;
    pinned = true;
  }
  if (!(Config.QueueProvider in raw) && hasValue(Config.RedisUrl)) {
    raw[Config.QueueProvider] = QueueProviderType.Bullmq;
    pinned = true;
  }
  return pinned;
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
  [Config.DbProvider]: "bytebell set db-provider <mongo|...>",
  [Config.GraphProvider]: "bytebell set graph-provider <neo4j|...>",
  [Config.QueueProvider]: "bytebell set queue-provider <bullmq|honker>",
  [Config.QueueDbPath]: "bytebell set queue-db-path <path>",
  [Config.SqlitePath]: "bytebell set sqlite-path <path>",
  [Config.LadybugPath]: "bytebell set ladybug-path <path>",
  [Config.IngestionStrategy]: "bytebell set ingestion.strategy <flat-folder|concept-graph>",
  [Config.EnrichmentModel]: "bytebell set enrichment.model <model-id>",
  [Config.EnrichmentMaxToolCallsPerFile]: "bytebell set enrichment.max.tool.calls.per.file <n>",
  [Config.EnrichmentMaxIterationsPerFile]: "bytebell set enrichment.max.iterations.per.file <n>",
  [Config.EnrichmentWallTimeMsPerFile]: "bytebell set enrichment.wall.time.ms.per.file <ms>",
  [Config.EnrichmentConcurrency]: "bytebell set enrichment.concurrency <n>",
  [Config.EnrichmentMaxToolResultChars]: "bytebell set enrichment.max.tool.result.chars <n>",
};

export { readField, writeField } from "./schema-fields.ts";
