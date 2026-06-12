// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { readFile, stat, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { getBytebellHome, getConfigValue } from "@bb/config";
import { Config } from "@bb/types";
import {
  ServerStartTimeoutError,
  ServerInfraDownError,
  ServerInfraUnreachableError,
  ServerProcessExitedError,
} from "@bb/errors";
import { ensureServerRunning } from "./serverSpawn.ts";
import { createSpinner, error } from "./output.ts";

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

async function readPid(pidFile: string): Promise<number | null> {
  try {
    const raw = await readFile(pidFile, "utf8");
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function errorCode(cause: unknown): string | undefined {
  if (cause !== null && typeof cause === "object" && "code" in cause) {
    const code = (cause as Record<string, unknown>)["code"];
    if (typeof code === "string") {
      return code;
    }
  }
  return undefined;
}

/** `kill(pid, 0)` probes liveness: ESRCH → dead, EPERM → alive but not ours
 * to signal (still counts as running). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause: unknown) {
    return errorCode(cause) === "EPERM";
  }
}

/** Pids holding a LISTEN socket on the given TCP port, via `lsof`. Returns
 * `[]` when lsof is absent or finds nothing — callers degrade gracefully. */
function findListenerPids(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], (cause, stdout) => {
      if (cause !== null || stdout.length === 0) {
        resolve([]);
        return;
      }
      const pids = stdout
        .split(/\s+/u)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n > 0);
      resolve([...new Set(pids)]);
    });
  });
}

/** Stops when no process still holds the server port. When lsof is unavailable
 *  (findListenerPids returns `[]`), falls back to `isAlive`-polling on
 *  `knownPids`. */
async function waitForServerStopped(port: number, knownPids?: Set<number>): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const listenerPids = await findListenerPids(port);
    if (listenerPids.length > 0) {
      await sleep(POLL_INTERVAL_MS);
    } else if (knownPids && knownPids.size > 0 && [...knownPids].some(isAlive)) {
      await sleep(POLL_INTERVAL_MS);
    } else {
      return true;
    }
  }
  const listenerPids = await findListenerPids(port);
  if (listenerPids.length > 0) {
    return false;
  }
  if (knownPids && knownPids.size > 0 && [...knownPids].some(isAlive)) {
    return false;
  }
  return true;
}

async function pidFileExists(pidFile: string): Promise<boolean> {
  try {
    await stat(pidFile);
    return true;
  } catch {
    return false;
  }
}

async function removeStalePidFile(pidFile: string): Promise<void> {
  if (await pidFileExists(pidFile)) {
    await unlink(pidFile).catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface StopServerResult {
  wasRunning: boolean;
  timedOut: boolean;
  pid: number | null;
}

/**
 * Stops the running server. Resolves targets from two sources — the live
 * process(es) holding the configured server port (via `lsof`) plus a still-
 * alive pid from `~/.bytebell/pid` — so a stale pid file (a double-start where
 * the loser died on the port-bind conflict without unlinking it) no longer
 * hides the real server. SIGTERMs each, waits until the port is free, and
 * cleans up any leftover pid file.
 */
export async function stopServer(): Promise<StopServerResult> {
  const pidFile = path.join(getBytebellHome(), "pid");
  const port = getConfigValue(Config.ServerPort);

  const filePid = await readPid(pidFile);
  const targets = new Set<number>();
  if (filePid !== null && isAlive(filePid)) {
    targets.add(filePid);
  }
  for (const pid of await findListenerPids(port)) {
    if (pid !== process.pid) {
      targets.add(pid);
    }
  }

  if (targets.size === 0) {
    await removeStalePidFile(pidFile);
    return { wasRunning: false, timedOut: false, pid: filePid };
  }

  let signalled = false;
  for (const pid of targets) {
    try {
      process.kill(pid, "SIGTERM");
      signalled = true;
    } catch (cause: unknown) {
      if (errorCode(cause) !== "ESRCH") {
        throw cause;
      }
    }
  }
  if (!signalled) {
    await removeStalePidFile(pidFile);
    return { wasRunning: false, timedOut: false, pid: filePid };
  }

  const drained = await waitForServerStopped(port, targets);
  if (drained) {
    await removeStalePidFile(pidFile);
  }
  const firstTarget = [...targets][0] ?? filePid;
  return { wasRunning: true, timedOut: !drained, pid: firstTarget };
}

export async function startServer(): Promise<boolean> {
  const spinner = createSpinner("Starting ByteBell server...");
  try {
    const ctx = await ensureServerRunning((line) => spinner.update(`Server: ${line}`));
    if (ctx.alreadyRunning) {
      spinner.stop(true, "Server already running");
    } else {
      spinner.stop(true, `Server started (logs: ${ctx.logPath ?? "n/a"})`);
    }
    return true;
  } catch (cause: unknown) {
    spinner.stop(false, "Server startup failed");
    if (cause instanceof ServerProcessExitedError) {
      error(cause.message);
      if (cause.logTail.length > 0) {
        error(cause.logTail);
      }
    } else if (cause instanceof ServerInfraUnreachableError) {
      error(`Infra not reachable: ${cause.services.map((s) => `${s.name} (${s.uri})`).join(", ")}. Is Docker running?`);
    } else if (cause instanceof ServerInfraDownError) {
      error(`Infra not reachable: ${cause.services.join(", ")}. Is Docker running?`);
    } else if (cause instanceof ServerStartTimeoutError) {
      error(cause.message);
    } else {
      error(cause instanceof Error ? cause.message : String(cause));
    }
    process.exitCode = 1;
    return false;
  }
}
