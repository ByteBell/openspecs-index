import type winston from "winston";
import { getLogger } from "./logger.ts";

export {
  getLogger,
  seedLoggerFactory,
  shutdownLoggers,
  __isLoggerFactorySeeded,
  __resetLoggersForTests,
} from "./logger.ts";
export type { LoggerScope, LoggerFactory } from "./logger.ts";

export { getLogsDir, ensureLogsDir, getRepoLogsDir, getArchiveLogsDir, ensureRepoLogDirs } from "./dirs.ts";

export { withRepoLog, settleRepoLog, getActiveRepoLogId } from "./repo-log.ts";
export type { RepoLogOptions } from "./repo-log.ts";

export type { Logger } from "winston";

export const logger = new Proxy({} as winston.Logger, {
  get(_target, prop, receiver) {
    const actual = getLogger("server");
    const value = Reflect.get(actual, prop, receiver);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(actual) : value;
  },
});
