#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { Config, DbProviderType, GraphProviderType, QueueProviderType, type Config as ConfigEnum } from "@bb/types";
import { getBytebellHome, getConfigValue, HINTS } from "@bb/config";
import { connectDb } from "@bb/db";
import { connectGraph, indexesGraph } from "@bb/graph-db";
import { connectQueue, resumeOrphans } from "@bb/queue";
// Provider registration is intentional and explicit at this composition root —
// the public server supports every provider (Docker + embedded), so it imports
// all of them. A different deployment that only needs a subset (e.g. a Neo4j +
// Mongo production server) would import only those packages here and would never
// load the unused drivers/native bindings (e.g. the `@bb/ladybug` core addon).
import "@bb/mongo";
import "@bb/sqlite";
import "@bb/neo4j";
import "@bb/ladybug";
import "@bb/queue-bullmq";
import "@bb/queue-honker";

import { registerGithubWorkers, registerLocalIngestWorker } from "@bb/ingest-github";
import { ServerConfigError } from "@bb/errors";
import { registerRoutes } from "./routes.ts";
import { installShutdownHandlers } from "./shutdown.ts";
import { reconcileLegacyLayout } from "./legacyLayout.ts";

const REQUIRED: ConfigEnum[] = [
  Config.MongoUri,
  Config.RedisUrl,
  Config.Neo4jUri,
  Config.Neo4jUser,
  Config.Neo4jPassword,
  Config.OpenrouterApiKey,
];

function checkRequiredConfig(): void {
  const missing: string[] = [];
  const hints: string[] = [];
  const dbProvider = getConfigValue(Config.DbProvider);
  const graphProvider = getConfigValue(Config.GraphProvider);
  const queueProvider = getConfigValue(Config.QueueProvider);

  const required = [...REQUIRED];
  const remove = (key: ConfigEnum): void => {
    const idx = required.indexOf(key);
    if (idx !== -1) {
      required.splice(idx, 1);
    }
  };

  if (dbProvider !== DbProviderType.Mongo) {
    remove(Config.MongoUri);
  }
  if (graphProvider !== GraphProviderType.Neo4j) {
    // Embedded graph (ladybug) needs no Neo4j connection details.
    remove(Config.Neo4jUri);
    remove(Config.Neo4jUser);
    remove(Config.Neo4jPassword);
  }
  if (queueProvider !== QueueProviderType.Bullmq) {
    remove(Config.RedisUrl);
  }

  // Embedded mode keeps its stores on disk — refuse to boot if any path the
  // active embedded provider depends on is unset, instead of failing later
  // with a cryptic file lock / IO error.
  if (dbProvider === DbProviderType.Sqlite) {
    required.push(Config.SqlitePath);
  }
  if (graphProvider === GraphProviderType.Ladybug) {
    required.push(Config.LadybugPath);
  }
  if (queueProvider === QueueProviderType.Honker) {
    required.push(Config.QueueDbPath);
  }

  for (const key of required) {
    const value = getConfigValue(key);
    if (typeof value === "string" && value.length === 0) {
      missing.push(key);
      hints.push(HINTS[key]);
    }
  }
  if (missing.length > 0) {
    throw new ServerConfigError(missing, hints);
  }
}

async function main(): Promise<void> {
  checkRequiredConfig();
  const dbProvider = getConfigValue(Config.DbProvider);
  await connectDb(dbProvider);
  // Self-heal the legacy on-disk layout: migrate what has a DB record, drop
  // orphans that don't. Needs the DB connection, so it runs after connectDb.
  await reconcileLegacyLayout();

  const graphProvider = getConfigValue(Config.GraphProvider);
  await connectGraph(graphProvider);
  await indexesGraph.ensureKnowledgeIndexes();
  const queueProvider = getConfigValue(Config.QueueProvider);
  await indexesGraph.ensureConceptGraphIndexes();
  await connectQueue(queueProvider);
  registerGithubWorkers();
  registerLocalIngestWorker();

  // Boot-time orphan recovery: re-publish any knowledge doc stuck in
  // KnowledgeState.Queued because the previous server crashed between
  // setKnowledgeState(QUEUED) and the queue publish. Run AFTER workers
  // are registered so resumed jobs are immediately consumable.
  const resume = await resumeOrphans();
  if (resume.scanned > 0) {
    process.stdout.write(
      `Orphan resumer: scanned=${resume.scanned} resumed=${resume.resumed} skipped=${resume.skipped}\n`,
    );
  }

  installShutdownHandlers();

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerRoutes(app);

  const port = getConfigValue(Config.ServerPort);
  app.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Bytebell server listening on http://127.0.0.1:${port}\n`);
  });

  await writeFile(path.join(getBytebellHome(), "pid"), String(process.pid), { mode: 0o644 });
}

main().catch((cause: unknown) => {
  if (cause instanceof ServerConfigError) {
    process.stderr.write(`${cause.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
