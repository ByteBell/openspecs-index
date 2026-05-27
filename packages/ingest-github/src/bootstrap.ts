import { seedConfig, getConfigValue } from "@bb/config";
import { seedLoggerFactory, type LoggerFactory } from "@bb/logger";
import { Config } from "@bb/types";
import { connectDb } from "@bb/db";
import { connectGraph, indexesGraph } from "@bb/graph-db";
import "@bb/mongo";
import "@bb/sqlite";
import "@bb/neo4j";
import "@bb/ladybug";

export interface BootstrapRuntimeOptions {
  config: unknown;
  loggerFactory: LoggerFactory;
}

export async function bootstrapRuntime(opts: BootstrapRuntimeOptions): Promise<void> {
  seedConfig(opts.config);
  seedLoggerFactory(opts.loggerFactory);

  const dbProvider = getConfigValue(Config.DbProvider);
  await connectDb(dbProvider);

  const graphProvider = getConfigValue(Config.GraphProvider);
  await connectGraph(graphProvider);

  // Fulltext indexes the MCP smart_search / keyword_lookup tools query against.
  // Idempotent (MERGE-based) so duplicate calls across composition roots are safe.
  await indexesGraph.ensureKnowledgeIndexes();
  await indexesGraph.ensureConceptGraphIndexes();
}
