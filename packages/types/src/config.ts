export enum Config {
  ServerPort = "server_port",
  MongoUri = "mongo_uri",
  Neo4jUri = "neo4j_uri",
  Neo4jUser = "neo4j_user",
  Neo4jPassword = "neo4j_password",
  RedisUrl = "redis_url",
  OpenrouterApiKey = "openrouter_api_key",
  OpenrouterModel = "openrouter_model",
  OpenrouterFallbackModel1 = "openrouter_fallback_model_1",
  OpenrouterFallbackModel2 = "openrouter_fallback_model_2",
  OpenrouterFallbackModel3 = "openrouter_fallback_model_3",
  OpenrouterFallbackModel4 = "openrouter_fallback_model_4",
  ConcurrencyGithub = "concurrency.github",
  LogLevel = "log_level",
  LogRetentionDays = "log_retention_days",
  LlmCacheEnabled = "llm_cache_enabled",
  LlmProvider = "llm_provider",
  OllamaUrl = "ollama_url",
  OllamaModel = "ollama_model",
  ContextWindowLimit = "context.window.limit",
  MaxTokensPerChunk = "max.tokens.per.chunk",
  BigFileConcurrency = "big.file.concurrency",
  AbsoluteFileSizeCap = "absolute.file.size.cap",
  ConcurrentWorkers = "concurrent.workers",
  LlmConcurrency = "llm.concurrency",
  FolderSummaryBatchSize = "folder.summary.batch.size",
  FolderSummaryBatchMaxFiles = "folder.summary.batch.max.files",
  Neo4jBatchSize = "neo4j.batch.size",
  CondenseContextLimit = "condense.context.limit",
  CondensePromptOverhead = "condense.prompt.overhead",
  SmallFileDedupThreshold = "small.file.dedup.threshold",
  BigFileLineThreshold = "big.file.line.threshold",
  OrgId = "org_id",
  SkipDecisionEnabled = "skip.decision.enabled",
  SkipDecisionMaxCharsForLlm = "skip.decision.max.chars.for.llm",
  SkipDecisionCachePath = "skip.decision.cache.path",
  DbProvider = "db_provider",
  GraphProvider = "graph_provider",
  QueueProvider = "queue_provider",
  QueueDbPath = "queue_db_path",
  SqlitePath = "sqlite_path",
  LadybugPath = "ladybug_path",
  IngestionStrategy = "ingestion.strategy",
  /**
   * Optional model for fine-grained per-unit analysis (the IR strategy's phase 7). When set, the
   * runner routes per-unit calls to this model instead of `openrouter_model`, letting a deployment
   * point the high-volume per-unit pass at a cheaper model. Empty → per-unit uses the main model.
   */
  UnitsModel = "units.model",
  EnrichmentModel = "enrichment.model",
  EnrichmentMaxToolCallsPerFile = "enrichment.max.tool.calls.per.file",
  EnrichmentMaxIterationsPerFile = "enrichment.max.iterations.per.file",
  EnrichmentWallTimeMsPerFile = "enrichment.wall.time.ms.per.file",
  EnrichmentConcurrency = "enrichment.concurrency",
  EnrichmentMaxToolResultChars = "enrichment.max.tool.result.chars",
}

export enum DbProviderType {
  Sqlite = "sqlite",
  Mongo = "mongo",
}

export enum GraphProviderType {
  Neo4j = "neo4j",
  Ladybug = "ladybug",
}

export enum QueueProviderType {
  Bullmq = "bullmq",
  Honker = "honker",
}
/**
 * Active ingestion strategy. `flat-folder` is the historic default that
 * produces `:Repo` + `:Folder` summaries via per-folder LLM passes.
 * `concept-graph` drops folder/repo summaries and runs a per-file
 * MCP-driven enrichment pass that emits `:Concept` / `:Contract` /
 * `:Guidepost` nodes instead.
 */
export enum IngestionStrategyType {
  FlatFolder = "flat-folder",
  ConceptGraph = "concept-graph",
  IntermediateRepresentation = "intermediate-representation",
}
