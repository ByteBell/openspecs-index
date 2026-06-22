// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { Config, DbProviderType, GraphProviderType, QueueProviderType } from "@bb/types";
import { getConfigValue, setConfigValue } from "@bb/config";
import { applyInfraDefaults, type ApplyDefaultsResult } from "./infraDefaults.ts";

/**
 * Infrastructure mode is not a stored flag — it's derived from the three
 * provider settings. There are two coherent presets:
 *
 *   • "docker"   (non-embedded) — Mongo + Neo4j + BullMQ. Requires Docker.
 *   • "embedded"                — SQLite + Ladybug + Honker. Zero Docker.
 *
 * The providers remain the single source of truth; `mode` is a convenience the
 * setup surfaces use to set all three at once and to decide whether `boot`
 * should bring Docker up.
 */
export type InfraMode = "docker" | "embedded";

export interface InfraModeOption {
  value: InfraMode;
  label: string;
  hint: string;
}

/**
 * UI metadata for the two infra presets, recommended preset first. This is the
 * single source for the labels/hints shown by the install wizard and the `set`
 * setup form — keep mode descriptions here, not inlined per surface.
 */
export const INFRA_MODE_OPTIONS: readonly InfraModeOption[] = [
  {
    value: "embedded",
    label: "Embedded (recommended)",
    hint: "SQLite + Ladybug + Honker — no Docker, everything in local files under ~/.bytebell",
  },
  {
    value: "docker",
    label: "Docker",
    hint: "Mongo + Neo4j + Redis — Docker needed (Docker Desktop/engine must be running)",
  },
];

/** UI metadata for a single infra mode (falls back to the recommended preset). */
export function infraModeOption(mode: InfraMode): InfraModeOption {
  for (const option of INFRA_MODE_OPTIONS) {
    if (option.value === mode) {
      return option;
    }
  }
  return INFRA_MODE_OPTIONS[0] ?? { value: "embedded", label: "Embedded", hint: "" };
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

export const EMBEDDED_PROVIDERS: ProviderTriple = {
  db: DbProviderType.Sqlite,
  graph: GraphProviderType.Ladybug,
  queue: QueueProviderType.Honker,
};

export type ComposeService = "mongo" | "neo4j" | "redis";

/**
 * The Docker compose services the current provider combo requires. Empty when
 * every provider is file-based (embedded mode).
 */
export function composeServicesNeeded(): Set<ComposeService> {
  const needed = new Set<ComposeService>();
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

/** True when at least one provider needs a Docker container. */
export function needsDocker(): boolean {
  return composeServicesNeeded().size > 0;
}

/** True when the active provider combo is fully file-based (no Docker). */
export function isEmbedded(): boolean {
  return !needsDocker();
}

/** The infra mode the active provider combo corresponds to. */
export function currentInfraMode(): InfraMode {
  return isEmbedded() ? "embedded" : "docker";
}

/**
 * Apply one of the two presets to the three provider config keys, then
 * auto-fill the per-service config the new providers need so the user never has
 * to set every detail by hand: docker mode fills the mongo/neo4j/redis URIs and
 * the neo4j password; embedded mode fills the file-based store paths. Any value
 * the user already set is left untouched. Returns the keys that were filled.
 */
export function applyInfraMode(mode: InfraMode): ApplyDefaultsResult {
  const providers = mode === "embedded" ? EMBEDDED_PROVIDERS : DOCKER_PROVIDERS;
  setConfigValue(Config.DbProvider, providers.db);
  setConfigValue(Config.GraphProvider, providers.graph);
  setConfigValue(Config.QueueProvider, providers.queue);
  return applyInfraDefaults();
}
