# `@bb/logger` — context

## Tier

Infrastructure. Depends on `@bb/config`, `winston`, and
`winston-daily-rotate-file`. May be imported by every higher tier (Strategy,
Domain, Binaries).

## Responsibility

Single logging surface for the workspace. Sinks:

- **File** — daily-rotated `~/.bytebell/logs/<scope>-YYYY-MM-DD.log`, gzipped
  on rotation, retained for `log_retention_days`.
- **Console** — always on; verbosity from `log_level`. Colorized when stdout
  is a TTY.
- **Per-repo file** _(opt-in, via `withRepoLog`)_ — while a repo is being
  indexed its log lines are mirrored into `~/.bytebell/logs/repos/<label>.log`.
  The file stays in `repos/` for the **whole life of the job**, including across
  retries (each attempt appends behind a boundary banner — one log per repo,
  every attempt in order). It moves to `~/.bytebell/logs/archive/<label>.log`
  only when the queue reports the job **terminal** (success, retries exhausted,
  or cancelled) via `settleRepoLog`. So `repos/` = repos still indexing (or
  between retries), `archive/` = repos whose indexing has fully settled. Purely
  additive: the same lines still land in `<scope>-*.log` and the console.

## Public exports

```ts
type LoggerScope = "server" | "cli"
type LoggerFactory = (scope: LoggerScope) => Logger
type Logger                                          // re-exported from winston

const logger: Logger                                 // proxy → getLogger("server")
function getLogger(scope: LoggerScope): Logger
function seedLoggerFactory(factory: LoggerFactory): void
function shutdownLoggers(): Promise<void>
function getLogsDir(): string
function ensureLogsDir(): void
function getRepoLogsDir(): string                    // <logsDir>/repos
function getArchiveLogsDir(): string                 // <logsDir>/archive
function ensureRepoLogDirs(): void

type RepoLogOptions = { knowledgeId: string; label: string }
function withRepoLog<T>(opts: RepoLogOptions, fn: () => Promise<T>): Promise<T>
function settleRepoLog(knowledgeId: string): void
function getActiveRepoLogId(): string | undefined

function __isLoggerFactorySeeded(): boolean
function __resetLoggersForTests(): void              // test-only
```

`withRepoLog(opts, fn)` attaches a dedicated `File` transport to the server
logger, runs `fn` inside an `AsyncLocalStorage` context tagged with
`opts.knowledgeId`, and on settle detaches + flushes the transport. It does **not**
archive — the file is left in `repos/<label>.log` (appended to on the next retry)
so an in-flight repo stays visible there. Because workers in the same process
index repos concurrently, the per-repo transport's format **filters by the active
async context's knowledgeId** (`getActiveRepoLogId()`) — a record is written to a
repo file only if it was emitted inside that run's context, so concurrent runs
never bleed into each other's files. Call sites are unchanged: they keep logging
through the `logger` proxy.

`settleRepoLog(knowledgeId)` is the terminal hook: it moves `repos/<label>.log`
into `archive/<label>.log` and forgets the in-flight entry. The **queue provider**
calls it when a job reaches a terminal state — `@bb/queue-honker` on `ack`
(success) and when the dead-letter sweep exhausts retries; `@bb/queue-bullmq` on
the `completed` / final `failed` worker events; both also on job cancellation.
It is idempotent and a no-op for knowledgeIds without an in-flight per-repo log
(e.g. job types that never call `withRepoLog`). This split exists because only
the queue knows whether a failed attempt will be retried — the per-attempt
handler just throws.

`logger` (the default export) is a Proxy that lazily resolves to
`getLogger("server")` on every access — necessary because the resolved logger
may change after `seedLoggerFactory` is called by a parent process.

`seedLoggerFactory(factory)` registers a factory used by all subsequent
`getLogger(scope)` calls. The previous scope cache is cleared on registration
so any logger already imported via the `logger` proxy resolves to the new
factory's output on its next method call. When no factory is seeded,
`getLogger` falls back to `buildLogger(scope)` — the disk-backed
DailyRotateFile + Console transport setup. The standalone binary never seeds
and gets the original behaviour bit-for-bit.

`getLogger(scope)` is idempotent. Workers tag via
`getLogger("server").child({ worker: "pdf-1" })` — there is no per-worker file
split.

## Sugar log API

`logger.info("message", obj)` auto-stringifies `obj` via `util.inspect` —
single-line for compact objects, multi-line for big ones. Circular refs are
handled gracefully.

## File layout

- `src/dirs.ts` — log dir resolution (under `getBytebellHome()/logs`), incl.
  `repos/` + `archive/` per-repo dirs
- `src/caller.ts` — stack-walk `file:line` helper
- `src/formats.ts` — sugar splat format + caller format + printf
- `src/transports.ts` — daily-rotate file + console + per-repo file factories
- `src/repo-log-context.ts` — `AsyncLocalStorage` holder for the active repo id
  (leaf module, so `transports.ts` reads it without a cycle)
- `src/repo-log.ts` — `withRepoLog` (per-attempt capture) + `settleRepoLog`
  (terminal `repos/` → `archive/` move) + the knowledgeId → in-flight registry
- `src/logger.ts` — `getLogger`, scope cache, shutdown
- `src/index.ts` — public re-exports

## Invariants

1. **No `process.env` reads.** All config flows through `@bb/config`.
2. **One file root per scope.** Scopes write to distinct rotated files.
3. **Console always on.** Local-first tool — the console is the UX. Verbosity
   via `log_level`.
4. **Idempotent `getLogger`.** Same scope → same `Logger` instance.
5. **`shutdownLoggers` drains.** Awaits each transport's `finish` / `close`
   event before resolving (with a 1-second hard cap so SIGTERM can't hang).
6. **Per-repo logs are context-scoped, not time-scoped.** A `repos/*.log` file
   captures exactly the lines emitted inside its `withRepoLog` async context —
   never lines from a concurrent run sharing the same process and logger.
7. **Repo logs are additive.** `withRepoLog` only _adds_ a transport; it never
   removes or mutates the scope/console sinks, so the global log is unaffected.
8. **A repo is in exactly one of `repos/` or `archive/`.** `withRepoLog` never
   archives; `settleRepoLog` moves the single file. While a job lives (including
   between retries) it is in `repos/`; once terminal it is in `archive/`.
   Settlement is the queue's call — only it knows if a failed attempt will retry.

## Data ownership

- `~/.bytebell/logs/` directory creation (mode `0700`)
- `~/.bytebell/logs/<scope>-*.log` rotated files (mode `0600`)
- `~/.bytebell/logs/<scope>-*.log.gz` compressed rotated files
- `~/.bytebell/logs/repos/` + `~/.bytebell/logs/archive/` dirs (mode `0700`)
- `~/.bytebell/logs/repos/<label>.log` in-flight per-repo files (mode `0600`)
- `~/.bytebell/logs/archive/<label>.log` consolidated per-repo log, one file per
  repo with every (retried) attempt appended (mode `0600`)

## What is intentionally out of scope

- Per-_worker_ file split (per-_repo_ files exist via `withRepoLog`; workers
  within a repo still share that repo's file)
- Retention/pruning of `archive/` (per-repo files are not date-rotated; a future
  boot-time sweep can prune by `log_retention_days` if needed)
- Re-homing a `repos/` file left behind by a crashed run (no terminal signal
  fires across a crash; on restart the job re-runs, re-appends, and settles
  normally — a truly orphaned file just lingers in `repos/`)
- Promptness of terminal-failure settling under Honker: the dead-letter move is
  picked up by the 30s sweep, so a fully-failed repo can sit in `repos/` for up
  to ~30s after its last attempt before landing in `archive/` (success and
  cancellation settle immediately)
- JS↔TS path remapping (Bun runs TS directly)
- Custom log levels (winston defaults are kept)
