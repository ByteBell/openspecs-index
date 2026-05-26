import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMPOSE_HEALTH_POLL_MS = 2_000;
const COMPOSE_HEALTH_TIMEOUT_MS = 90_000;
const SERVICES = ["mongo", "neo4j", "redis"] as const;

type ServiceName = (typeof SERVICES)[number];

export class DockerNotFoundError extends Error {
  override readonly name = "DockerNotFoundError";
  constructor() {
    super("`docker` was not found on PATH. Install Docker Desktop or the Docker engine and retry.");
  }
}

export class DockerComposeError extends Error {
  override readonly name = "DockerComposeError";
  constructor(stage: string, exitCode: number, stderr: string) {
    super(`compose ${stage} failed (exit ${exitCode}): ${stderr.trim() || "no stderr"}`);
  }
}

export class DockerHealthTimeoutError extends Error {
  override readonly name = "DockerHealthTimeoutError";
  constructor(unhealthy: ServiceName[]) {
    super(
      `services not healthy after ${COMPOSE_HEALTH_TIMEOUT_MS / 1000}s: ${unhealthy.join(", ")}. Inspect with \`docker-compose -f infra/docker/docker-compose.yml logs\`.`,
    );
  }
}

interface ComposePsRow {
  Service?: string;
  Health?: string;
  State?: string;
}

interface UpOptions {
  neo4jPassword: string;
  onProgress?: (line: string) => void;
}

export interface UpResult {
  composeFile: string;
  services: Record<ServiceName, string>;
}

export function composeFilePath(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "..", "..", "infra", "docker", "docker-compose.yml");
}

function envFilePath(): string {
  return path.resolve(path.dirname(composeFilePath()), ".env");
}

let composeBinary: "docker" | "docker-compose" | null = null;

async function resolveComposeBinary(): Promise<"docker" | "docker-compose"> {
  if (composeBinary !== null) {
    return composeBinary;
  }
  const fromPlugin = await runRawCheck(["docker", "compose", "version"]);
  if (fromPlugin) {
    composeBinary = "docker";
    return composeBinary;
  }
  const fromStandalone = await runRawCheck(["docker-compose", "version"]);
  if (fromStandalone) {
    composeBinary = "docker-compose";
    return composeBinary;
  }
  composeBinary = "docker";
  return composeBinary;
}

function runRawCheck(args: string[]): Promise<boolean> {
  const binary = args[0];
  if (binary === undefined) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const child = spawn(binary, args.slice(1), { stdio: "ignore" });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function runCompose(
  args: string[],
  stage: string,
  inheritStdout: boolean,
): Promise<{ stdout: string; stderr: string }> {
  const binary = await resolveComposeBinary();
  const allArgs = binary === "docker" ? ["compose", ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, allArgs, {
      stdio: ["ignore", inheritStdout ? "inherit" : "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (cause: Error & { code?: string }) => {
      if (cause.code === "ENOENT") {
        reject(new DockerNotFoundError());
        return;
      }
      reject(cause);
    });
    child.on("exit", (code) => {
      const exit = typeof code === "number" ? code : 0;
      if (exit === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new DockerComposeError(stage, exit, stderr));
    });
  });
}

export async function up(opts: UpOptions): Promise<UpResult> {
  await writeEnvFile(opts.neo4jPassword);
  await runCompose(["-f", composeFilePath(), "up", "-d"], "up", true);

  const unhealthy = await waitUntilHealthy(opts.onProgress);
  if (unhealthy.length > 0) {
    throw new DockerHealthTimeoutError(unhealthy);
  }
  return {
    composeFile: composeFilePath(),
    services: {
      mongo: "127.0.0.1:27017",
      neo4j: "127.0.0.1:7687 (HTTP 7474)",
      redis: "127.0.0.1:6379",
    },
  };
}

async function writeEnvFile(neo4jPassword: string): Promise<void> {
  const target = envFilePath();
  const body = `NEO4J_PASSWORD=${neo4jPassword}\n`;
  await writeFile(target, body, { mode: 0o600 });
}

async function waitUntilHealthy(onProgress?: (line: string) => void): Promise<ServiceName[]> {
  const start = Date.now();
  while (Date.now() - start < COMPOSE_HEALTH_TIMEOUT_MS) {
    const rows = await psSnapshot();
    const status = summarize(rows);
    if (onProgress !== undefined) {
      onProgress(formatProgress(status));
    }
    if (status.unhealthy.length === 0) {
      return [];
    }
    await sleep(COMPOSE_HEALTH_POLL_MS);
  }
  const final = await psSnapshot();
  return summarize(final).unhealthy;
}

interface StatusSummary {
  healthy: ServiceName[];
  unhealthy: ServiceName[];
}

function summarize(rows: ComposePsRow[]): StatusSummary {
  const healthy: ServiceName[] = [];
  const unhealthy: ServiceName[] = [];
  for (const service of SERVICES) {
    const row = rows.find((r) => r.Service === service);
    if (row !== undefined && row.Health === "healthy") {
      healthy.push(service);
    } else {
      unhealthy.push(service);
    }
  }
  return { healthy, unhealthy };
}

function formatProgress(status: StatusSummary): string {
  const tag = (name: ServiceName): string => (status.healthy.includes(name) ? `${name} ✓` : `${name} …`);
  return SERVICES.map(tag).join("  ");
}

async function psSnapshot(): Promise<ComposePsRow[]> {
  const { stdout } = await runCompose(["-f", composeFilePath(), "ps", "--format", "json"], "ps", false);
  return parsePsOutput(stdout);
}

export function parsePsOutput(stdout: string): ComposePsRow[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map(coerceRow) : [];
  }
  const rows: ComposePsRow[] = [];
  for (const line of trimmed.split("\n")) {
    const candidate = line.trim();
    if (candidate.length === 0) {
      continue;
    }
    const parsed: unknown = JSON.parse(candidate);
    rows.push(coerceRow(parsed));
  }
  return rows;
}

function coerceRow(value: unknown): ComposePsRow {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const obj = value as Record<string, unknown>;
  const out: ComposePsRow = {};
  if (typeof obj["Service"] === "string") {
    out.Service = obj["Service"];
  }
  if (typeof obj["Health"] === "string") {
    out.Health = obj["Health"];
  }
  if (typeof obj["State"] === "string") {
    out.State = obj["State"];
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
