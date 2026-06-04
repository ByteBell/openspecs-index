// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import fs from "node:fs";
import path from "node:path";
import { ensureRepoLogDirs, getArchiveLogsDir, getRepoLogsDir } from "./dirs.ts";
import { getLogger } from "./logger.ts";
import { runWithRepoLogContext } from "./repo-log-context.ts";
import { makeRepoFileTransport, flushTransport } from "./transports.ts";

const FILE_MODE = 0o600;

export interface RepoLogOptions {
  /** Knowledge id being indexed; used to filter records into this run's file. */
  readonly knowledgeId: string;
  /**
   * Filesystem-safe label for the file stem, e.g. `facebook-react-3f9c2a1b`.
   * Callers build it from owner/repo + a short id; `withRepoLog` sanitizes
   * defensively in case the caller did not.
   */
  readonly label: string;
}

interface ActiveRepoLog {
  readonly activePath: string;
  readonly stem: string;
}

/**
 * knowledgeId → in-flight per-repo log file. An entry lives here from the first
 * attempt of a job until the queue tells us the job is terminal (via
 * `settleRepoLog`), at which point the file moves from `repos/` to `archive/`.
 * Keyed by knowledgeId because that is the only identifier the queue layer has
 * when a job settles — it never sees the human label.
 */
const activeByKnowledge = new Map<string, ActiveRepoLog>();

/** Strips anything that is not safe in a filename so labels can't escape the dir. */
function sanitize(label: string): string {
  const cleaned = label.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return cleaned.length > 0 ? cleaned : "repo";
}

/**
 * Runs `fn` with a dedicated per-repo log file attached to the server logger.
 *
 * While `fn` runs, every `logger.*` call made inside its async context is
 * mirrored into `logs/repos/<label>.log` (in addition to the normal
 * `server-*.log` and console sinks). The file **stays in `repos/` for the whole
 * life of the job** — including across BullMQ/Honker retries, which re-enter
 * `withRepoLog` for the same knowledgeId and append behind a fresh banner.
 *
 * The file is moved to `logs/archive/<label>.log` only when the queue reports
 * the job terminal (success or retries exhausted) via `settleRepoLog`. So a repo
 * that is still indexing — or waiting between retries — is found in `repos/`,
 * and `archive/` holds only repos whose indexing has fully settled.
 *
 * `fn`'s outcome is never masked: a throw propagates after the transport is
 * flushed; settlement is the queue's responsibility, not this function's.
 */
export async function withRepoLog<T>(opts: RepoLogOptions, fn: () => Promise<T>): Promise<T> {
  ensureRepoLogDirs();
  const stem = sanitize(opts.label);
  const activePath = path.join(getRepoLogsDir(), `${stem}.log`);
  activeByKnowledge.set(opts.knowledgeId, { activePath, stem });
  appendBanner(activePath, opts.knowledgeId);
  const logger = getLogger("server");
  const transport = makeRepoFileTransport(activePath, opts.knowledgeId);
  logger.add(transport);
  try {
    return await runWithRepoLogContext(opts.knowledgeId, fn);
  } finally {
    logger.remove(transport);
    await flushTransport(transport);
  }
}

/**
 * Moves a settled job's per-repo log from `repos/` into `archive/`. Called by
 * the queue provider when a job reaches a terminal state (acked after success,
 * or moved to the dead-letter table after retries are exhausted).
 *
 * Safe to call repeatedly and for any knowledgeId: it is a no-op when no
 * in-flight log is registered (e.g. job types that don't use `withRepoLog`, or
 * a second settle signal for an already-archived run).
 */
export function settleRepoLog(knowledgeId: string): void {
  const entry = activeByKnowledge.get(knowledgeId);
  if (entry === undefined) {
    return;
  }
  activeByKnowledge.delete(knowledgeId);
  if (!fs.existsSync(entry.activePath)) {
    return;
  }
  // Labels embed the knowledgeId, so the archive name is unique per job — a
  // plain rename can't clobber another repo's consolidated log.
  const archivePath = path.join(getArchiveLogsDir(), `${entry.stem}.log`);
  try {
    fs.renameSync(entry.activePath, archivePath);
  } catch {
    // Best-effort: leave the file in repos/ rather than throw from a queue hook.
  }
}

/** Writes a per-attempt boundary banner so retries stay legible within one file. */
function appendBanner(activePath: string, knowledgeId: string): void {
  try {
    fs.appendFileSync(activePath, `\n========== index run ${knowledgeId} ==========\n`, { mode: FILE_MODE });
  } catch {
    // Banner is cosmetic; never let it break the run.
  }
}

export { getActiveRepoLogId } from "./repo-log-context.ts";
