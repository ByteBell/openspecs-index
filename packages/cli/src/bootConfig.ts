// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { Config, DbProviderType, GraphProviderType, QueueProviderType } from "@bb/types";
import { getConfigValue, requiredKeysFor } from "@bb/config";
import { bringInfraUp } from "./dockerBoot.ts";
import { applyInfraDefaults } from "./infraDefaults.ts";
import { success, error, info } from "./output.ts";
import { isEmbedded } from "./infraMode.ts";
import { startServer } from "./serverLifecycle.ts";

export interface PreflightResult {
  ok: boolean;
  missing: { configKey: Config; hintKey: string }[];
}

const CONFIG_HINT_KEYS: Partial<Record<Config, string>> = {
  [Config.OpenrouterApiKey]: "openrouter-api-key",
  [Config.OpenrouterModel]: "openrouter-model",
  [Config.OllamaUrl]: "ollama-url",
  [Config.OllamaModel]: "ollama-model",
};

export function checkPreflight(): PreflightResult {
  const provider = getConfigValue(Config.LlmProvider);
  const required = requiredKeysFor(provider, {
    db: getConfigValue(Config.DbProvider),
    graph: getConfigValue(Config.GraphProvider),
    queue: getConfigValue(Config.QueueProvider),
  });
  const missing: PreflightResult["missing"] = [];
  for (const configKey of required) {
    const value = getConfigValue(configKey);
    const isEmpty = typeof value === "string" ? value.length === 0 : false;
    if (isEmpty) {
      const hintKey = CONFIG_HINT_KEYS[configKey] ?? String(configKey);
      missing.push({ configKey, hintKey });
    }
  }
  return { ok: missing.length === 0, missing };
}

export async function runBootSequence(): Promise<boolean> {
  const defaults = applyInfraDefaults();
  for (const entry of defaults.written) {
    if (entry.redacted) {
      success(`set ${entry.cliKey}=<redacted> (auto-generated)`);
    } else {
      success(`set ${entry.cliKey} (auto-filled with default)`);
    }
  }

  // Embedded mode (sqlite + ladybug + honker) needs no external services — skip
  // Docker entirely and go straight to starting the server.
  if (isEmbedded()) {
    info("embedded mode — no Docker required (sqlite + ladybug + honker).");
  } else {
    if (getConfigValue(Config.GraphProvider) === GraphProviderType.Neo4j && defaults.neo4jPassword.length === 0) {
      error("internal: neo4j password is empty after applyInfraDefaults — refusing to start docker.");
      process.exitCode = 1;
      return false;
    }

    const upResult = await bringInfraUp(defaults.neo4jPassword);
    if (upResult === null) {
      return false;
    }
    if (getConfigValue(Config.DbProvider) === DbProviderType.Mongo) {
      success(`mongo  → ${upResult.services.mongo}`);
    }
    if (getConfigValue(Config.GraphProvider) === GraphProviderType.Neo4j) {
      success(`neo4j  → ${upResult.services.neo4j}`);
    }
    if (getConfigValue(Config.QueueProvider) === QueueProviderType.Bullmq) {
      success(`redis  → ${upResult.services.redis}`);
    }
  }

  const started = await startServer();
  if (!started) {
    return false;
  }

  const port = getConfigValue(Config.ServerPort);
  success(`MCP endpoint: http://127.0.0.1:${port}/mcp`);
  return true;
}
