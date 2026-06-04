// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the knowledgeId of the repo index running in the current async
 * context. `withRepoLog` (in `repo-log.ts`) sets it for the duration of a job;
 * the per-repo transport's filter (`repoFilter` in `transports.ts`) reads it to
 * decide whether a given log record belongs to its file.
 *
 * This lives in its own leaf module so `transports.ts` can read the active id
 * without importing `repo-log.ts` (which itself imports the transport factory),
 * keeping the dependency graph acyclic.
 */
interface RepoLogContext {
  readonly knowledgeId: string;
}

const storage = new AsyncLocalStorage<RepoLogContext>();

export function getActiveRepoLogId(): string | undefined {
  return storage.getStore()?.knowledgeId;
}

export function runWithRepoLogContext<T>(knowledgeId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ knowledgeId }, fn);
}
