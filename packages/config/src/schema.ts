import { z } from "zod";
import { Config } from "@bb/types";

export { Config };

export const LOG_LEVELS = ["error", "warn", "info", "http", "verbose", "debug", "silly"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LLM_PROVIDERS = ["openrouter", "ollama", "anthropic", "bedrock", "gemini", "openai"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const INFRA_MODES = ["docker", "cloud", "embedded"] as const;
export type InfraMode = (typeof INFRA_MODES)[number];

// The PUBLIC strategies the open-source engine ships. A downstream deployment
// may set `ingestion.strategy` to a private strategy name this list does not
// enumerate, so the stored config value is a free string (validated below).
export const INGESTION_STRATEGIES = ["flat-folder", "concept-graph"] as const;
export type IngestionStrategy = string;

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
    anthropic_api_key: z.string().default(""),
    anthropic_model: z.string().default("claude-sonnet-5"),
    bedrock_api_key: z.string().default(""),
    // No default. The region is an endpoint locator, not a credential — a
    // wrong one fails as "model not found" rather than "misconfigured", so an
    // unset region is caught by the boot gate with a precise hint instead.
    bedrock_region: z.string().default(""),
    bedrock_model: z.string().default("anthropic.claude-sonnet-5"),
    gemini_api_key: z.string().default(""),
    gemini_model: z.string().default("gemini-2.5-flash"),
    openai_api_key: z.string().default(""),
    openai_model: z.string().default(""),
    openai_base_url: z.string().default(""),
    aws_access_key_id: z.string().default(""),
    aws_secret_access_key: z.string().default(""),
    aws_session_token: z.string().default(""),
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
    db_provider: z.string().default("mongo"),
    graph_provider: z.string().default("neo4j"),
    queue_provider: z.string().default("bullmq"),
    infra_mode: z.enum(INFRA_MODES).default("docker"),
    queue_db_path: z.string().default(""),
    sqlite_path: z.string().default(""),
    ladybug_path: z.string().default(""),
    // Free string: the OSS engine routes the public strategies it knows
    // (flat-folder / concept-graph) and lets any other value pass through to a
    // downstream deployment that supplies its own (private) strategy.
    "ingestion.strategy": z.string().default("flat-folder"),
    "units.model": z.string().default(""),
    "enrichment.model": z.string().default(""),
    "enrichment.max.tool.calls.per.file": z.number().int().positive().default(15),
    "enrichment.max.iterations.per.file": z.number().int().positive().default(8),
    "enrichment.wall.time.ms.per.file": z.number().int().positive().default(400000),
    "enrichment.concurrency": z.number().int().positive().default(16),
    "enrichment.max.tool.result.chars": z.number().int().positive().default(20000),
    // Reasoning + total-output caps for OpenRouter. Default 0 = omit (provider default, uncapped) so
    // OSS standalone is unchanged; a deployment sets these to bound a reasoning model's thinking/output.
    "openrouter.reasoning.max.tokens": z.number().int().nonnegative().default(0),
    "openrouter.max.completion.tokens": z.number().int().nonnegative().default(0),
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
  [Config.AnthropicApiKey]: string;
  [Config.AnthropicModel]: string;
  [Config.BedrockApiKey]: string;
  [Config.BedrockRegion]: string;
  [Config.BedrockModel]: string;
  [Config.GeminiApiKey]: string;
  [Config.GeminiModel]: string;
  [Config.OpenaiApiKey]: string;
  [Config.OpenaiModel]: string;
  [Config.OpenaiBaseUrl]: string;
  [Config.AwsAccessKeyId]: string;
  [Config.AwsSecretAccessKey]: string;
  [Config.AwsSessionToken]: string;
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
  [Config.InfraMode]: InfraMode;
  [Config.QueueDbPath]: string;
  [Config.SqlitePath]: string;
  [Config.LadybugPath]: string;
  [Config.IngestionStrategy]: IngestionStrategy;
  [Config.UnitsModel]: string;
  [Config.EnrichmentModel]: string;
  [Config.EnrichmentMaxToolCallsPerFile]: number;
  [Config.EnrichmentMaxIterationsPerFile]: number;
  [Config.EnrichmentWallTimeMsPerFile]: number;
  [Config.EnrichmentConcurrency]: number;
  [Config.EnrichmentMaxToolResultChars]: number;
  [Config.OpenrouterReasoningMaxTokens]: number;
  [Config.OpenrouterMaxCompletionTokens]: number;
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
  anthropic: [Config.AnthropicApiKey, Config.AnthropicModel],
  // Bedrock takes EITHER a bearer API key OR SigV4 credentials OR an ambient
  // instance role, so no single credential key is universally required — the
  // provider fails with a precise hint when none resolves. Region and model are
  // always needed.
  bedrock: [Config.BedrockRegion, Config.BedrockModel],
  gemini: [Config.GeminiApiKey, Config.GeminiModel],
  // Bedrock accepts either a bearer API key or SigV4 credentials, so neither is
  // individually required — `resolveBedrockAuth` fails with a precise hint when
  // both are absent. Region is always needed.
  openai: [Config.OpenaiApiKey, Config.OpenaiModel],
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
  [Config.OpenrouterApiKey]: "bytebell set openrouter-api-key <key>",
  [Config.OpenrouterModel]: "bytebell models set <model-id>",
  [Config.OpenrouterFallbackModel1]: "bytebell set openrouter-fallback-model-1 <model-id>",
  [Config.OpenrouterFallbackModel2]: "bytebell set openrouter-fallback-model-2 <model-id>",
  [Config.OpenrouterFallbackModel3]: "bytebell set openrouter-fallback-model-3 <model-id>",
  [Config.OpenrouterFallbackModel4]: "bytebell set openrouter-fallback-model-4 <model-id>",
  [Config.ConcurrencyGithub]: "bytebell set concurrency.github <n>",
  [Config.LogLevel]: "bytebell set log-level <error|warn|info|debug>",
  [Config.LogRetentionDays]: "bytebell set log-retention-days <n>",
  [Config.LlmCacheEnabled]: "bytebell set llm_cache_enabled <true|false>",
  [Config.LlmProvider]: "bytebell set llm-provider <openrouter|ollama|anthropic|bedrock|gemini|openai>",
  [Config.OllamaUrl]: "bytebell set ollama-url <url>",
  [Config.OllamaModel]: "bytebell set ollama-model <model>",
  [Config.AnthropicApiKey]: "bytebell set anthropic-api-key <key>",
  [Config.AnthropicModel]: "bytebell set anthropic-model <model-id>",
  [Config.BedrockApiKey]: "bytebell set bedrock-api-key <key>",
  [Config.BedrockRegion]: "bytebell set bedrock-region <region>",
  [Config.BedrockModel]: "bytebell set bedrock-model <model-id>",
  [Config.GeminiApiKey]: "bytebell set gemini-api-key <key>",
  [Config.GeminiModel]: "bytebell set gemini-model <model-id>",
  [Config.OpenaiApiKey]: "bytebell set openai-api-key <key>",
  [Config.OpenaiModel]: "bytebell set openai-model <model-id>",
  [Config.OpenaiBaseUrl]: "bytebell set openai-base-url <url>",
  [Config.AwsAccessKeyId]: "bytebell set aws-access-key-id <id>",
  [Config.AwsSecretAccessKey]: "bytebell set aws-secret-access-key <secret>",
  [Config.AwsSessionToken]: "bytebell set aws-session-token <token>",
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
  [Config.InfraMode]: "bytebell set infra-mode <docker|cloud|embedded>",
  [Config.QueueDbPath]: "bytebell set queue-db-path <path>",
  [Config.SqlitePath]: "bytebell set sqlite-path <path>",
  [Config.LadybugPath]: "bytebell set ladybug-path <path>",
  [Config.IngestionStrategy]: "bytebell set ingestion.strategy <flat-folder|concept-graph>",
  [Config.UnitsModel]: "bytebell set units.model <model-id>",
  [Config.EnrichmentModel]: "bytebell set enrichment.model <model-id>",
  [Config.EnrichmentMaxToolCallsPerFile]: "bytebell set enrichment.max.tool.calls.per.file <n>",
  [Config.EnrichmentMaxIterationsPerFile]: "bytebell set enrichment.max.iterations.per.file <n>",
  [Config.EnrichmentWallTimeMsPerFile]: "bytebell set enrichment.wall.time.ms.per.file <ms>",
  [Config.EnrichmentConcurrency]: "bytebell set enrichment.concurrency <n>",
  [Config.EnrichmentMaxToolResultChars]: "bytebell set enrichment.max.tool.result.chars <n>",
  [Config.OpenrouterReasoningMaxTokens]: "bytebell set openrouter.reasoning.max.tokens <n>",
  [Config.OpenrouterMaxCompletionTokens]: "bytebell set openrouter.max.completion.tokens <n>",
};

export { readField, writeField } from "./schema-fields.ts";
