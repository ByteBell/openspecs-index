import fs from "node:fs";
import path from "node:path";
import { getBytebellHome, isDevMode } from "@bb/config";

const LOGS_DIR_NAME = "logs";
const REPO_LOGS_DIR_NAME = "repos";
const ARCHIVE_LOGS_DIR_NAME = "archive";
const DIR_MODE = 0o700;

/**
 * Resolves the directory log files are written to. In dev mode
 * (`BYTEBELL_DEV=1`) this is `<cwd>/logs/`, so contributors can tail logs
 * from the project they're working in. Otherwise the canonical
 * `~/.bytebell/logs/` is used. The CLI's server-spawn redirect honors the
 * same toggle, so both Winston output and bun stdout/stderr land together.
 */
export function getLogsDir(): string {
  if (isDevMode()) {
    return path.join(process.cwd(), LOGS_DIR_NAME);
  }
  return path.join(getBytebellHome(), LOGS_DIR_NAME);
}

/**
 * `<logsDir>/repos/` — one `.log` file per in-flight repo index. A file lives
 * here only while its ingestion is running; `withRepoLog` moves it into the
 * archive dir once the job settles (success or failure).
 */
export function getRepoLogsDir(): string {
  return path.join(getLogsDir(), REPO_LOGS_DIR_NAME);
}

/**
 * `<logsDir>/archive/` — finished per-repo logs, retained for after-the-fact
 * debugging. This is where you look up "what happened when repo X was indexed".
 */
export function getArchiveLogsDir(): string {
  return path.join(getLogsDir(), ARCHIVE_LOGS_DIR_NAME);
}

export function ensureLogsDir(): void {
  fs.mkdirSync(getLogsDir(), { recursive: true, mode: DIR_MODE });
}

/** Ensures both the active (`repos/`) and `archive/` per-repo log dirs exist. */
export function ensureRepoLogDirs(): void {
  fs.mkdirSync(getRepoLogsDir(), { recursive: true, mode: DIR_MODE });
  fs.mkdirSync(getArchiveLogsDir(), { recursive: true, mode: DIR_MODE });
}
