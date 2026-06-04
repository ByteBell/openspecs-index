// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Config, DbProviderType, GraphProviderType, QueueProviderType } from "@bb/types";
import { getBytebellHome, getConfigValue } from "@bb/config";
import { KEY_MAP } from "./keyMap.ts";

const DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017/bytebell";
const DEFAULT_NEO4J_URI = "bolt://127.0.0.1:7687";
const DEFAULT_NEO4J_USER = "neo4j";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

interface DefaultEntry {
  cliKey: string;
  configKey: Config;
  computeDefault: () => string;
  /** Only auto-fill when the active provider combo actually uses this service. */
  needed: () => boolean;
}

function usingMongo(): boolean {
  return getConfigValue(Config.DbProvider) === DbProviderType.Mongo;
}

function usingNeo4j(): boolean {
  return getConfigValue(Config.GraphProvider) === GraphProviderType.Neo4j;
}

const DEFAULTS: readonly DefaultEntry[] = [
  { cliKey: "mongo", configKey: Config.MongoUri, computeDefault: () => DEFAULT_MONGO_URI, needed: usingMongo },
  { cliKey: "neo4j", configKey: Config.Neo4jUri, computeDefault: () => DEFAULT_NEO4J_URI, needed: usingNeo4j },
  { cliKey: "neo4j-user", configKey: Config.Neo4jUser, computeDefault: () => DEFAULT_NEO4J_USER, needed: usingNeo4j },
  {
    cliKey: "redis",
    configKey: Config.RedisUrl,
    computeDefault: () => DEFAULT_REDIS_URL,
    needed: () => getConfigValue(Config.QueueProvider) === QueueProviderType.Bullmq,
  },
  {
    cliKey: "neo4j-password",
    configKey: Config.Neo4jPassword,
    computeDefault: generateNeo4jPassword,
    needed: usingNeo4j,
  },
  // Embedded stores live under ~/.bytebell. These are auto-filled (and required
  // by the server preflight) because the providers don't all default to a
  // persistent path on their own — notably Ladybug treats an empty path as
  // in-memory, which would silently lose the graph on restart.
  {
    cliKey: "sqlite-path",
    configKey: Config.SqlitePath,
    computeDefault: () => path.join(getBytebellHome(), "data.sqlite"),
    needed: () => getConfigValue(Config.DbProvider) === DbProviderType.Sqlite,
  },
  {
    cliKey: "ladybug-path",
    configKey: Config.LadybugPath,
    computeDefault: () => path.join(getBytebellHome(), "ladybug.lbug"),
    needed: () => getConfigValue(Config.GraphProvider) === GraphProviderType.Ladybug,
  },
  {
    cliKey: "queue-db-path",
    configKey: Config.QueueDbPath,
    computeDefault: () => path.join(getBytebellHome(), "queue.db"),
    needed: () => getConfigValue(Config.QueueProvider) === QueueProviderType.Honker,
  },
];

export interface ApplyDefaultsResult {
  written: { cliKey: string; redacted: boolean }[];
  neo4jPassword: string;
}

/**
 * Auto-fill the per-service config the *active* provider combo needs, leaving
 * any value the user already set untouched. Docker providers fill mongo/neo4j/
 * redis URIs and the neo4j password; embedded providers fill the file paths.
 */
export function applyInfraDefaults(): ApplyDefaultsResult {
  const written: { cliKey: string; redacted: boolean }[] = [];
  for (const entry of DEFAULTS) {
    if (!entry.needed()) {
      continue;
    }
    const current = readString(entry.configKey);
    if (current.length > 0) {
      continue;
    }
    const value = entry.computeDefault();
    const setter = KEY_MAP[entry.cliKey];
    if (setter === undefined) {
      throw new Error(`internal: KEY_MAP entry "${entry.cliKey}" missing`);
    }
    setter.setter(value);
    written.push({ cliKey: entry.cliKey, redacted: setter.redact });
  }
  return {
    written,
    neo4jPassword: readString(Config.Neo4jPassword),
  };
}

function readString(key: Config): string {
  const value = getConfigValue(key);
  return typeof value === "string" ? value : "";
}

function generateNeo4jPassword(): string {
  return randomBytes(24).toString("base64url");
}
