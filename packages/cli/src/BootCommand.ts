// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { Command } from "commander";
import { Config } from "@bb/types";
import { HINTS, getConfigValue, isDevMode } from "@bb/config";
import { applyInfraDefaults, checkPreflight } from "./bootConfig.ts";
import {
  DockerComposeError,
  DockerHealthTimeoutError,
  DockerNotFoundError,
  DockerPortConflictError,
  composeFilePath,
  down,
  up,
  type UpResult,
} from "./dockerInfra.ts";
import { ServerStartTimeoutError, ensureServerRunning } from "./serverSpawn.ts";
import { createSpinner, error, info, success } from "./output.ts";
import {
  labelForService,
  readInfraPorts,
  serviceForPort,
  setInfraPort,
  type InfraPorts,
  type InfraService,
} from "./infraPorts.ts";
import { diagnosePortConflict, promptPortConflict } from "./portConflictPrompt.ts";
import { removeContainer } from "./dockerPortDiagnostics.ts";
import { ensureGlobalLink } from "./globalLink.ts";

const MAX_CONFLICT_ROUNDS = 4;

export function buildBootCommand(): Command {
  const cmd = new Command("boot");
  cmd.description("Bring up Docker infra (mongo + neo4j + redis) and start the bytebell-server.").action(runBoot);
  return cmd;
}

async function runBoot(): Promise<void> {
  if (!enforcePreflight()) {
    process.exitCode = 1;
    return;
  }

  if (isDevMode()) {
    info(`dev mode: logs → ${process.cwd()}/logs/`);
  }

  const defaults = applyInfraDefaults();
  for (const entry of defaults.written) {
    if (entry.redacted) {
      success(`set ${entry.cliKey}=<redacted> (auto-generated)`);
    } else {
      success(`set ${entry.cliKey} (auto-filled with local-docker default)`);
    }
  }

  if (defaults.neo4jPassword.length === 0) {
    error("internal: neo4j password is empty after applyInfraDefaults — refusing to start docker.");
    process.exitCode = 1;
    return;
  }

  const upResult = await bringInfraUp(defaults.neo4jPassword);
  if (upResult === null) {
    return;
  }
  success(`mongo  → ${upResult.services.mongo}`);
  success(`neo4j  → ${upResult.services.neo4j}`);
  success(`redis  → ${upResult.services.redis}`);

  if (!(await startServer())) {
    return;
  }

  ensureGlobalLink();

  const port = getConfigValue(Config.ServerPort);
  success(`MCP endpoint: http://127.0.0.1:${port}/mcp`);
  process.stdout.write("\nNext: bytebell index <git-url>  or  bytebell ingest [path]\n");
}

async function bringInfraUp(neo4jPassword: string): Promise<UpResult | null> {
  const skipServices = new Set<"mongo" | "neo4j" | "redis">();
  for (let round = 0; round < MAX_CONFLICT_ROUNDS; round += 1) {
    const ports = readInfraPorts();
    const watched = composeServicesToStart(skipServices);
    const spinner = createSpinner("Starting Docker infrastructure...");
    try {
      const result = await up({
        neo4jPassword,
        ports,
        servicesToStart: watched,
        onProgress: (line) => spinner.update(`Docker: ${line}`),
      });
      spinner.stop(true, `Docker infra is up (${composeFilePath()})`);
      for (const svc of skipServices) {
        info(`reusing existing service on port ${portFor(svc, ports)} for ${svc} (not managed by bytebell)`);
      }
      return result;
    } catch (cause: unknown) {
      spinner.stop(false, "Docker startup failed");
      if (cause instanceof DockerPortConflictError) {
        const handled = await handlePortConflict(cause, ports, skipServices);
        if (handled) {
          continue;
        }
        process.exitCode = 1;
        return null;
      }
      handleDockerError(cause);
      return null;
    }
  }
  error(`Gave up after ${MAX_CONFLICT_ROUNDS} attempts to resolve port conflicts.`);
  process.exitCode = 1;
  return null;
}

async function handlePortConflict(
  cause: DockerPortConflictError,
  ports: InfraPorts,
  skipServices: Set<"mongo" | "neo4j" | "redis">,
): Promise<boolean> {
  const infraService = serviceForPort(cause.port, ports);
  if (infraService === null) {
    error(`Port ${cause.port} conflict, but it doesn't match a known bytebell service. Aborting.`);
    info(cause.stderr.trim());
    return false;
  }
  const composeService = composeServiceFor(infraService);
  const serviceLabel = labelForService(infraService);
  const ctx = await diagnosePortConflict(cause.port, serviceLabel);
  const resolution = await promptPortConflict(ctx);

  if (resolution.action === "cancel") {
    error("Boot cancelled.");
    return false;
  }

  // Tear down the half-created compose state so the retry starts clean.
  await safeComposeDown();

  if (resolution.action === "reuse") {
    skipServices.add(composeService);
    success(`will reuse existing ${serviceLabel} on port ${cause.port}.`);
    return true;
  }
  if (resolution.action === "kill") {
    if (ctx.container === null) {
      error("Nothing to remove — the conflicting process isn't a docker container. Stop it manually and retry.");
      return false;
    }
    try {
      await removeContainer(ctx.container.id);
      success(`removed conflicting container ${ctx.container.name}.`);
    } catch (e: unknown) {
      error(`docker rm -f ${ctx.container.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    return true;
  }
  if (resolution.action === "change") {
    const newPort = resolution.newPort;
    if (newPort === undefined) {
      error("internal: change selected without a new port.");
      return false;
    }
    setInfraPort(infraService, newPort);
    success(`updated bytebell ${serviceLabel} → port ${newPort}.`);
    skipServices.delete(composeService);
    return true;
  }
  return false;
}

async function safeComposeDown(): Promise<void> {
  try {
    await down();
  } catch {
    // best-effort cleanup — ignore failures
  }
}

function composeServicesToStart(skip: Set<"mongo" | "neo4j" | "redis">): readonly ("mongo" | "neo4j" | "redis")[] {
  if (skip.size === 0) {
    return ["mongo", "neo4j", "redis"];
  }
  return (["mongo", "neo4j", "redis"] as const).filter((s) => !skip.has(s));
}

function composeServiceFor(service: InfraService): "mongo" | "neo4j" | "redis" {
  if (service === "mongo") {
    return "mongo";
  }
  if (service === "redis") {
    return "redis";
  }
  return "neo4j";
}

function portFor(service: "mongo" | "neo4j" | "redis", ports: InfraPorts): number {
  if (service === "mongo") {
    return ports.mongo;
  }
  if (service === "redis") {
    return ports.redis;
  }
  return ports.neo4jBolt;
}

async function startServer(): Promise<boolean> {
  const spinner = createSpinner("Starting ByteBell server...");
  try {
    const ctx = await ensureServerRunning((line) => spinner.update(`Server: ${line}`));
    if (ctx.alreadyRunning) {
      spinner.stop(true, "Server already running");
      if (ctx.devModeMismatch === true) {
        info(
          "BYTEBELL_DEV=1 set but server is already running. Run `bytebell shutdown && BYTEBELL_DEV=1 bytebell boot` to apply.",
        );
      }
    } else {
      spinner.stop(true, `Server started (logs: ${ctx.logPath ?? "n/a"})`);
    }
    return true;
  } catch (cause: unknown) {
    spinner.stop(false, "Server startup failed");
    if (cause instanceof ServerStartTimeoutError) {
      error(cause.message);
    } else {
      error(cause instanceof Error ? cause.message : String(cause));
    }
    process.exitCode = 1;
    return false;
  }
}

function enforcePreflight(): boolean {
  const result = checkPreflight();
  if (result.ok) {
    return true;
  }
  for (const entry of result.missing) {
    error(`${entry.hintKey} is not set`, HINTS[entry.configKey]);
  }
  return false;
}

function handleDockerError(cause: unknown): void {
  if (cause instanceof DockerNotFoundError) {
    error(cause.message);
  } else if (cause instanceof DockerComposeError) {
    error(cause.message);
  } else if (cause instanceof DockerHealthTimeoutError) {
    error(cause.message);
  } else {
    error(cause instanceof Error ? cause.message : String(cause));
  }
  process.exitCode = 1;
}
