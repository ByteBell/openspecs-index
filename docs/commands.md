# OpenSpecs CLI — Commands

`bytebell` is the interactive CLI. Commands start the local OpenSpecs instance in the background automatically when needed — you never manage it by hand.

```
bytebell [command] [...args]
```

Run `bytebell --help` or `bytebell <command> --help` for the live list. Global flags: `-V, --version`, `-h, --help`.

## Quick reference

| Command               | What it does                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `setup`               | First-run wizard: LLM provider, infra (embedded/Docker), optional index, editor wiring. **Start here.** |
| `set [key] [value]`   | Write a setting (no args → interactive form). Keys: [configuration.md](configuration.md). |
| `boot`                | Start OpenSpecs (embedded → no Docker; Docker mode → brings up containers first). |
| `shutdown`            | Stop OpenSpecs.                                                                |
| `index <git-url>`     | Index a remote git repository.                                               |
| `ingest [path]`       | Index a local directory (defaults to the current directory).                 |
| `pull [knowledge-id]` | Re-index a previously added GitHub repo at branch HEAD (diff-aware).          |
| `ls`                  | List indexed repos and their state.                                          |
| `delete`              | Pick an indexed repo and remove it.                                          |
| `stats`               | Ingestion totals, per-repo and per-commit token usage.                       |
| `mcp install`         | Detect installed editors and wire in the MCP endpoint.                       |
| `mcp stats`           | MCP request and token usage.                                                 |
| `migrate paths`       | One-off on-disk layout migration (`--dry-run` supported).                    |

---

## `bytebell setup`

Interactive first-run wizard (requires a terminal — it won't run piped). It walks you through, in order:

1. **LLM provider** — OpenRouter (API key + model) or Ollama (URL + model).
2. **Infrastructure** — **Embedded** (SQLite + LadybugDB + Honker, no Docker; the default) or **Docker** (Mongo + Neo4j + Redis).
3. **Repo** — optionally paste a GitHub URL to index right away.

It then boots OpenSpecs, indexes your repo, and wires the MCP endpoint into your detected editors.

```
bytebell setup
```

One command from nothing to a queryable, editor-wired graph. Every step it automates is also available standalone (`set`, `boot`, `index`, `mcp install`).

---

## `bytebell set [key] [value]`

Writes a setting to `~/.bytebell/config.json`. Run with no arguments to open the interactive form. Values are validated before they're saved.

```
bytebell set port 7777
bytebell set openrouter-api-key sk-or-v1-...
bytebell set                 # opens the interactive form
```

This is the only sanctioned way to write config — there is no `.env` file. The full key list (validation, defaults, redaction) is in **[configuration.md](configuration.md)**.

---

## `bytebell boot`

Starts OpenSpecs. Runs a preflight first (and prints the exact `bytebell set …` to fix anything missing).

- **Embedded mode** (default): no Docker — the stores are local files under `~/.bytebell`.
- **Docker mode**: brings up the containers your providers need (mongo / neo4j / redis), waits for health, then starts the server.

```
bytebell boot
```

Output ends with the MCP endpoint URL (`http://127.0.0.1:<port>/mcp`) and a hint to run `bytebell index` or `bytebell ingest` next.

---

## `bytebell shutdown`

Stops OpenSpecs. In Docker mode the containers are left running (it prints the `docker compose … down` command to stop them).

```
bytebell shutdown
```

---

## `bytebell index <git-url> [options]`

Clones a remote git repository and indexes it. URL must be `https://…`.

```
bytebell index https://github.com/owner/repo
bytebell index https://github.com/owner/repo --branch dev
bytebell index https://github.com/owner/private --token ghp_xxx
bytebell index https://github.com/owner/repo --verbose
```

| Option            | Description                                                            |
| ----------------- | --------------------------------------------------------------------- |
| `--branch <name>` | Branch to index (defaults to the repo's default branch)               |
| `--token <pat>`   | GitHub PAT for private repos                                           |
| `--verbose`       | Stream the log to the terminal during the run (pair with `set log-level debug` for more detail) |

A spinner / progress bar tracks the job until it reaches `PROCESSED` or `FAILED`.

---

## `bytebell ingest [path]`

Indexes a local directory — defaults to the current working directory. Progress UI is identical to `index`.

```
bytebell ingest                       # ingest the current directory
bytebell ingest /abs/path/to/repo
bytebell ingest ./relative/path
```

---

## `bytebell pull [knowledge-id] [options]`

Re-indexes a previously added **GitHub** repo at the branch's current HEAD (diff-aware — only changed files are re-analysed). Does not apply to local ingests.

```
bytebell pull                                # interactive multi-select picker
bytebell pull 1ee3bac7-...                   # pull one repo by id
bytebell pull 1ee3bac7-... --commit deadbee  # anchor to a specific commit SHA
bytebell pull --token ghp_xxx                # private repo
bytebell pull --verbose                      # tail server logs during the run
```

| Option           | Description                                                       |
| ---------------- | ---------------------------------------------------------------- |
| `--commit <sha>` | Specific commit to anchor against (defaults to branch HEAD)      |
| `--token <pat>`  | GitHub PAT for private repos                                     |
| `--verbose`      | Stream the log to the terminal during the run                    |

With no id, a multi-select picker lists every GitHub repo — toggle as many as you want and re-index them in parallel. If a repo is already at the target commit, it's a no-op.

---

## `bytebell ls`

Lists indexed repos as `ID | SOURCE | STATE | UPDATED | FILES`. Source shows as `github:<slug>[@branch]` or `local:<path>`. State follows the lifecycle `CREATED → QUEUED → INGESTED → PROCESSING → PROCESSED` (or `FAILED`).

```
bytebell ls
```

---

## `bytebell delete`

Interactive picker over the `ls` output. Removes the chosen repo entirely — file rows, graph nodes, raw artefacts, stats, and any pending jobs.

```
bytebell delete
```

---

## `bytebell stats`

Renders three sections:

- **TOTALS** — repos, files, input/output tokens, estimated cost (USD).
- **REPOS** — per-repo breakdown: `NAME | TYPE | FILES | INPUT | OUTPUT | COST`.
- **COMMITS** — per-commit token usage.

```
bytebell stats
```

`COST` shows `$0.000000` or `unknown` when pricing data is missing (e.g. Ollama).

---

## `bytebell mcp`

### `bytebell mcp install`

Detects installed editors — Claude Code, Cursor, Claude Desktop, Windsurf, VS Code — and writes the OpenSpecs MCP endpoint into each one's config, backing up the file first. `bytebell setup` runs this for you on first boot.

```
bytebell mcp install
```

If no editors are detected, it prints the manual `claude mcp add --transport http bytebell http://127.0.0.1:<port>/mcp` command.

### `bytebell mcp stats`

```
bytebell mcp stats
```

Renders global MCP usage (requests + input/output tokens) and a monthly per-identity breakdown.

---

## `bytebell migrate paths`

One-off on-disk layout reconciliation: migrates the legacy `~/.bytebell/repos/.meta/<id>/` tree to the commit-scoped `~/.bytebell/orgs/…` layout. Repos with a database record are migrated; orphaned directories are removed.

```
bytebell migrate paths            # run the migration
bytebell migrate paths --dry-run  # show what would change without touching disk
```

The same reconciliation runs automatically on boot — this command just lets you run it ahead of time or inspect it with `--dry-run`.

---

## Lifecycle quick-start

```
bytebell setup                        # first run: provider + infra + optional index + editor wiring
bytebell index https://github.com/owner/repo
bytebell ls
bytebell pull                         # re-index against branch HEAD
bytebell stats
bytebell shutdown                     # stop OpenSpecs
```

---

## The `--verbose` flag

Available on `bytebell index` and `bytebell pull`. When set, the CLI tails the OpenSpecs log file (`~/.bytebell/logs/server-YYYY-MM-DD.log`) to the terminal alongside the progress bar for the duration of the job.

The flag controls **what you see**, not what's logged — the log level is separate. For more detail, run `bytebell set log-level debug` first, then re-run with `--verbose`.

```
bytebell set log-level debug
bytebell index https://github.com/owner/repo --verbose
```
