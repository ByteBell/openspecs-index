// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import path from "node:path";
import { Config, DbProviderType, GraphProviderType, QueueProviderType } from "@bb/types";
import { getBytebellHome, getConfigValue, setConfigValue } from "@bb/config";

/**
 * Infrastructure mode defines how ByteBell runs its databases:
 *
 *   • "embedded" — SQLite + Ladybug + Honker. Zero Docker.
 *   • "cloud"    — Mongo + Neo4j + Redis hosted in the cloud (Atlas, Neo4j Aura, etc.). Zero Docker.
 *   • "docker"   — Mongo + Neo4j + Redis local instances. Requires Docker.
 */
export type InfraMode = "docker" | "cloud" | "embedded";

export interface InfraModeOption {
  value: InfraMode;
  label: string;
  hint: string;
}

/**
 * UI metadata for the infra presets, recommended preset first. This is the
 * single source for the labels/hints shown by the install wizard and the `set`
 * setup form — keep mode descriptions here, not inlined per surface.
 */
export const INFRA_MODE_OPTIONS: readonly InfraModeOption[] = [
  {
    value: "docker",
    label: "Docker",
    hint: "Mongo + Neo4j + Redis in local Docker — if instances are not running, run 'bytebell boot' to start them (Docker Desktop required)",
  },
  {
    value: "cloud",
    label: "Cloud",
    hint: "Mongo + Neo4j + Redis in the cloud — provide your cloud instance URLs below (zero Docker)",
  },
  // Embedded mode temporarily disabled from TUI
  // {
  //   value: "embedded",
  //   label: "Embedded (recommended)",
  //   hint: "SQLite + Ladybug + Honker — no Docker, everything in local files under ~/.bytebell",
  // },
];

/** UI metadata for a single infra mode (falls back to the recommended preset). */
export function infraModeOption(mode: InfraMode): InfraModeOption {
  for (const option of INFRA_MODE_OPTIONS) {
    if (option.value === mode) {
      return option;
    }
  }
  return INFRA_MODE_OPTIONS[0] ?? { value: "docker", label: "Docker", hint: "" };
}

interface ProviderTriple {
  db: DbProviderType;
  graph: GraphProviderType;
  queue: QueueProviderType;
}

export const DOCKER_PROVIDERS: ProviderTriple = {
  db: DbProviderType.Mongo,
  graph: GraphProviderType.Neo4j,
  queue: QueueProviderType.Bullmq,
};

export const CLOUD_PROVIDERS: ProviderTriple = {
  db: DbProviderType.Mongo,
  graph: GraphProviderType.Neo4j,
  queue: QueueProviderType.Bullmq,
};

export const EMBEDDED_PROVIDERS: ProviderTriple = {
  db: DbProviderType.Sqlite,
  graph: GraphProviderType.Ladybug,
  queue: QueueProviderType.Honker,
};

export type ComposeService = "mongo" | "neo4j" | "redis";

/**
 * The Docker compose services the current provider combo requires. Empty when
 * every provider is file-based (embedded mode) or cloud-hosted.
 */
export function composeServicesNeeded(): Set<ComposeService> {
  const needed = new Set<ComposeService>();
  if (isCloud() || isEmbedded()) {
    return needed;
  }
  if (getConfigValue(Config.DbProvider) === DbProviderType.Mongo) {
    needed.add("mongo");
  }
  if (getConfigValue(Config.GraphProvider) === GraphProviderType.Neo4j) {
    needed.add("neo4j");
  }
  if (getConfigValue(Config.QueueProvider) === QueueProviderType.Bullmq) {
    needed.add("redis");
  }
  return needed;
}

/** Get the currently configured infra mode (or derive from provider settings). */
export function getInfraMode(): InfraMode {
  const stored = getConfigValue(Config.InfraMode);
  if (stored === "cloud" || stored === "docker" || stored === "embedded") {
    return stored;
  }
  if (
    getConfigValue(Config.DbProvider) === DbProviderType.Sqlite &&
    getConfigValue(Config.GraphProvider) === GraphProviderType.Ladybug &&
    getConfigValue(Config.QueueProvider) === QueueProviderType.Honker
  ) {
    return "embedded";
  }
  return "docker";
}

/** True when the active infra mode is cloud-hosted external instances (no Docker). */
export function isCloud(): boolean {
  return getInfraMode() === "cloud";
}

/** True when the active provider combo is fully file-based (no Docker). */
export function isEmbedded(): boolean {
  return getInfraMode() === "embedded";
}

/** True when at least one provider needs a Docker container. */
export function needsDocker(): boolean {
  return !isCloud() && !isEmbedded() && composeServicesNeeded().size > 0;
}

/**
 * Embedded-mode store paths, derived from the bytebell home so the user never
 * has to set them by hand. Filled on entering embedded mode; an existing
 * non-empty value (an explicit override) is left untouched.
 */
const EMBEDDED_PATH_DEFAULTS: ReadonlyArray<readonly [Config, string]> = [
  [Config.SqlitePath, "data.sqlite"],
  [Config.LadybugPath, "ladybug.lbug"],
  [Config.QueueDbPath, "queue.db"],
];

const DOCKER_DEFAULTS: ReadonlyArray<readonly [Config, string]> = [
  [Config.MongoUri, "mongodb://127.0.0.1:27017/bytebell"],
  [Config.Neo4jUri, "bolt://127.0.0.1:7687"],
  [Config.Neo4jUser, "neo4j"],
  [Config.RedisUrl, "redis://127.0.0.1:6379"],
];

/** Apply one of the presets to the provider config keys. */
export function applyInfraMode(mode: InfraMode): void {
  setConfigValue(Config.InfraMode, mode);
  const providers = mode === "embedded" ? EMBEDDED_PROVIDERS : mode === "cloud" ? CLOUD_PROVIDERS : DOCKER_PROVIDERS;
  setConfigValue(Config.DbProvider, providers.db);
  setConfigValue(Config.GraphProvider, providers.graph);
  setConfigValue(Config.QueueProvider, providers.queue);
  if (mode === "embedded") {
    const home = getBytebellHome();
    for (const [key, filename] of EMBEDDED_PATH_DEFAULTS) {
      const current = getConfigValue(key);
      if (typeof current === "string" && current.length === 0) {
        setConfigValue(key, path.join(home, filename));
      }
    }
  } else if (mode === "docker") {
    for (const [key, def] of DOCKER_DEFAULTS) {
      const current = getConfigValue(key);
      if (typeof current === "string" && current.length === 0) {
        setConfigValue(key, def);
      }
    }
  }
}
