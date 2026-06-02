# Bytebell CLI — Commands Reference

The `bytebell` binary is the Ink/commander TUI front-end. It never touches Mongo / Neo4j / Redis directly — every command resolves to an HTTP call against the local `bytebell-server` daemon, auto-starting it in the background when needed.

```
bytebell [command] [...args]
```

Global flags: `-V, --version`, `-h, --help`.

### `bytebell --help`

The output below is what commander prints in the current build (registration order from [packages/cli/src/index.ts](../packages/cli/src/index.ts)). If your installed binary shows a shorter list, it predates the additions and you should rebuild the CLI.

```
Usage: bytebell [options] [command]

Bytebell — local knowledge engine TUI

Options:
  -V, --version              output the version number
  -h, --help                 display help for command

Commands:
  set [key] [value]          Write a value to ~/.bytebell/config.json. With no args, opens the interactive setup form.
  boot                       Bring up Docker infra (mongo + neo4j + redis) and start the bytebell-server.
  shutdown                   Stop the bytebell-server (docker infra is left running).
  server                     Manage the bytebell-server daemon.
  index [options] <git-url>  Index a remote git repository.
  ingest [path]              Ingest a local directory (defaults to the current working directory).
  pull [options] [knowledge-id]
                             Re-index a previously added GitHub repo at the branch's current HEAD.
  ls                         List indexed knowledge entries.
  delete                     Pick an indexed knowledge entry and delete it from Mongo + Neo4j.
  stats                      Show ingestion totals, per-repo breakdown, and per-commit token usage.
  mcp                        Manage and view MCP usage.
  help [command]             display help for command
```

Per-command help is available as `bytebell <command> --help`, e.g.:

```
$ bytebell index --help
Usage: bytebell index [options] <git-url>

Index a remote git repository.

Arguments:
  git-url          https URL of the repository

Options:
  --branch <name>  branch to index (defaults to 'main' on the server)
  --token <pat>    GitHub PAT for private repos
  --verbose        stream the server log file to the terminal during the run (set log level via `bytebell set log-level debug` for finer-grained output)
  -h, --help       display help for command
```

```
$ bytebell pull --help
Usage: bytebell pull [options] [knowledge-id]

Re-index a previously added GitHub repo at the branch's current HEAD.

Arguments:
  knowledge-id     knowledge id (omit to pick interactively from the indexed repos)

Options:
  --commit <sha>   specific commit hash to anchor against (defaults to branch HEAD)
  --token <pat>    GitHub PAT for private repos
  --verbose        stream the server log file to the terminal during the run
  -h, --help       display help for command
```

```
$ bytebell mcp --help
Usage: bytebell mcp [options] [command]

Manage and view MCP usage.

Commands:
  stats            Show input/output token stats for MCP
  help [command]   display help for command
```

| Command     | Purpose                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `set`       | Write a value to `~/.bytebell/config.json` (interactive form if no args) |
| `boot`      | Start Docker infra (mongo + neo4j + redis) and the bytebell-server       |
| `shutdown`  | Stop the bytebell-server (Docker infra is left running)                  |
| `server`    | Manage the bytebell-server daemon                                        |
| `index`     | Index a remote git repository                                            |
| `pull`      | Re-index a previously added GitHub repo at branch HEAD (or a given SHA)  |
| `ingest`    | Ingest a local directory                                                 |
| `ls`        | List indexed knowledge entries                                           |
| `delete`    | Pick an entry and delete it from Mongo + Neo4j                           |
| `stats`     | Show ingestion totals, per-repo breakdown, per-commit token usage        |
| `mcp`       | Parent command for MCP usage subcommands                                 |
| `mcp stats` | Show input/output token stats for MCP (global + monthly breakdown)       |

---

## `bytebell set [key] [value]`

Writes to `~/.bytebell/config.json`. Run with no arguments to launch the interactive Ink setup form ([SetupForm.tsx](../packages/cli/src/SetupForm.tsx)). Headless form takes a key from the table below and a value; values are validated before they are persisted.

```
bytebell set port 7777
bytebell set openrouter-api-key sk-or-v1-...
bytebell set                 # opens the interactive form
```

Valid keys (see [keyMap.ts](../packages/cli/src/keyMap.ts)):

| Key                           | Validation          | Redacted in output |
| ----------------------------- | ------------------- | ------------------ |
| `mongo`                       | string (URI)        | no                 |
| `neo4j`                       | string (URI)        | no                 |
| `neo4j-user`                  | string              | no                 |
| `neo4j-password`              | string              | yes                |
| `redis`                       | string (URI)        | no                 |
| `port`                        | integer 1–65535     | no                 |
| `log-level`                   | one of `LOG_LEVELS` | no                 |
| `log-retention-days`          | positive integer    | no                 |
| `concurrency.github`          | positive integer    | no                 |
| `openrouter-api-key`          | string              | yes                |
| `openrouter-model`            | string              | no                 |
| `openrouter-fallback-model-1` | string              | no                 |
| `openrouter-fallback-model-2` | string              | no                 |
| `openrouter-fallback-model-3` | string              | no                 |
| `openrouter-fallback-model-4` | string              | no                 |

This is the only sanctioned write path to `config.json` (manual edits work but are not advertised). There is no `.env` file — see [CLAUDE.md](../CLAUDE.md) "Rule of Env Vars".

---

## `bytebell boot`

End-to-end "start everything" command ([BootCommand.ts](../packages/cli/src/BootCommand.ts)).

1. Runs preflight (refuses to boot when required config is missing — prints the exact `bytebell set …` to fix it).
2. Auto-fills local-Docker defaults for `mongo`, `neo4j`, `neo4j-user`, `neo4j-password`, `redis` if absent.
3. Brings up the docker-compose stack (mongo + neo4j + redis) and waits for healthchecks.
4. Starts `bytebell-server` in the background, prints the MCP endpoint URL.

```
bytebell boot
```

Output ends with `MCP endpoint: http://127.0.0.1:<port>/mcp` and a hint to run `bytebell index` or `bytebell ingest` next.

---

## `bytebell shutdown`

Sends `SIGTERM` to the running server (PID read from `~/.bytebell/pid`) and waits up to 30 s for it to drain ([ShutdownCommand.ts](../packages/cli/src/ShutdownCommand.ts)). Does **not** stop Docker infra — prints the `docker compose -f … down` command to do so manually.

```
bytebell shutdown
```

If the PID file is stale or absent, exits cleanly.

---

## `bytebell server`

Daemon management. Currently exposes one subcommand:

### `bytebell server start`

Runs `bun --bun packages/server/src/index.ts` in the **foreground** with stdio inherited (Ctrl+C to stop). Used for development / debugging — the other commands all auto-start the server in the background instead.

```
bytebell server start
```

---

## `bytebell index <git-url> [options]`

Clones a remote git repository on the server and runs the active `IngestionStrategy` against it ([IndexCommand.ts](../packages/cli/src/IndexCommand.ts)).

```
bytebell index https://github.com/owner/repo
bytebell index https://github.com/owner/repo --branch dev
bytebell index https://github.com/owner/private --token ghp_xxx
bytebell index https://github.com/owner/repo --verbose
```

Options:

| Option            | Description                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `--branch <name>` | Branch to index (defaults to `main` on the server)                                                         |
| `--token <pat>`   | GitHub PAT for private repos                                                                               |
| `--verbose`       | Stream the server log file to the terminal during the run. For finer-grained output set `log-level debug`. |

Auto-starts the server, then `POST /api/v1/github/index`, then polls `/api/v1/repos/<knowledgeId>` every 1.5 s, rendering a spinner / progress bar until the state reaches `PROCESSED` or `FAILED`. URL must be `https://…`.

---

## `bytebell pull [knowledge-id] [options]`

Re-indexes a previously added **GitHub** repo at the branch's current HEAD ([PullCommand.ts](../packages/cli/src/PullCommand.ts)). Pull does not apply to `local:` ingests — the picker filters them out.

```
bytebell pull                                # interactive multi-select picker
bytebell pull 1ee3bac7-...                   # pull one knowledgeId by id
bytebell pull 1ee3bac7-... --commit deadbee  # anchor to a specific SHA
bytebell pull --token ghp_xxx                # private repo
bytebell pull --verbose                      # tail server logs during the run
```

Options:

| Option           | Description                                                      |
| ---------------- | ---------------------------------------------------------------- |
| `--commit <sha>` | Specific commit hash to anchor against (defaults to branch HEAD) |
| `--token <pat>`  | GitHub PAT for private repos                                     |
| `--verbose`      | Stream the server log file to the terminal during the run        |

When no `knowledge-id` is supplied, an Ink picker opens listing every GitHub-sourced entry:

```
Select repos to pull  (0 selected)
▶ [ ] github:owner/repo PROCESSED  1ee3bac7…  8 files
  [ ] github:owner/other PROCESSED  d259915c…  7 files

[↑/↓ or j/k] move  [Space] toggle  [Enter] confirm  [Esc] cancel
```

The picker is **multi-select** — toggle as many repos as you want, then `Enter`. The CLI enqueues every selection in parallel via `POST /api/v1/github/pull` and polls each job concurrently. If the target commit already matches the latest indexed commit, the server short-circuits and the CLI prints `No-op: knowledge <id> already at commit <sha>`.

Ingests a local directory — defaults to the current working directory ([IngestCommand.ts](../packages/cli/src/IngestCommand.ts)).

```
bytebell ingest                       # ingest CWD
bytebell ingest /abs/path/to/repo
bytebell ingest ./relative/path
```

Validates that the path exists and is a directory before calling `POST /api/v1/local/index`. Polling and progress UI are identical to `index`.

---

## `bytebell ls`

Lists indexed knowledge entries by calling `GET /api/v1/repos` ([LsCommand.ts](../packages/cli/src/LsCommand.ts)).

```
bytebell ls
```

Renders a table of `ID | SOURCE | STATE | UPDATED | FILES`. Source is rendered as `github:<slug>[@branch]` or `local:<path>`. State follows the lifecycle: `CREATED → QUEUED → INGESTED → PROCESSING → PROCESSED` (or `FAILED`).

---

## `bytebell delete`

Interactive picker (Ink) over the `ls` output that issues `DELETE /api/v1/repos/<knowledgeId>` for the chosen entry ([DeleteCommand.ts](../packages/cli/src/DeleteCommand.ts)). Removes Mongo file rows, Neo4j nodes, raw artefacts, stats rows, and any pending BullMQ jobs.

```
bytebell delete
```

Confirmation message reports counts: `removed <slug> (raw: N, stats: N, jobs: N)`.

---

## `bytebell stats`

Hits `GET /api/v1/stats` and renders three sections ([StatsCommand.ts](../packages/cli/src/StatsCommand.ts)):

```
bytebell stats
```

- **TOTALS** — total repos, files, input tokens, output tokens, estimated cost (USD).
- **REPOS** — per-repo breakdown grouped by repository: `NAME | TYPE | FILES | INPUT | OUTPUT | COST`.
- **COMMITS** — per-commit token usage: `NAME | COMMIT | INPUT | OUTPUT | COST | TIME (ms) | FILES`.

`COST` is rendered as `$0.000000` or `unknown` when pricing data is missing.

---

## `bytebell mcp`

Parent command for MCP-related views ([McpCommand.ts](../packages/cli/src/McpCommand.ts)).

### `bytebell mcp stats`

Hits `GET /api/v1/mcp/stats` and renders:

- **Global MCP Usage** — total requests, input tokens, output tokens, total tokens.
- **Monthly Usage by Identity** — per-identity / per-month rows: `Identity | Period | Reqs | In Tokens | Out Tokens | Total`.

```
bytebell mcp stats
```

When no monthly rows exist, prints `No monthly usage records found.`

---

## Lifecycle quick-start

```
bytebell set                          # interactive first-run config
bytebell boot                         # docker + server
bytebell index https://github.com/owner/repo
bytebell ls
bytebell pull                         # re-index against branch HEAD
bytebell stats
bytebell mcp stats
bytebell delete                       # pick an entry to remove
bytebell shutdown                     # stop the server (docker stays up)
```

---

## The `--verbose` flag

Available on `bytebell index` and `bytebell pull` ([logTailer.ts](../packages/cli/src/logTailer.ts)).

- When set, the CLI **tails the active server log file** (`~/.bytebell/logs/server-YYYY-MM-DD.log`) and streams new lines to the terminal alongside the spinner / progress bar for the duration of the job.
- The flag controls **what you see**, not **what is logged**. The server's log level is independent — set it via `bytebell set log-level <level>` (one of the `LOG_LEVELS` from [@bb/config](../packages/config/)). For finer-grained output, run `bytebell set log-level debug` first, then re-run with `--verbose`.
- The tailer is started after the server is up and stopped automatically when the command finishes (success, failure, or Ctrl+C).
- Verbose output is only the server log; client-side spinners and progress bars are unaffected.

```
bytebell set log-level debug
bytebell index https://github.com/owner/repo --verbose
bytebell pull --verbose
```

---

## Notes

- Every command auto-starts `bytebell-server` in the background if it is not already running; logs are written to `~/.bytebell/logs/server-YYYY-MM-DD.log`.
- The `--help` text printed by `commander` may lag this document while features are added — the source files under [packages/cli/src/](../packages/cli/src/) are authoritative.
- All HTTP routes referenced above are documented (OpenAPI) on the server side per the "Rule of API Logging & Documentation" in [CLAUDE.md](../CLAUDE.md).
