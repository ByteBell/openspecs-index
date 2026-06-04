# Get started

**Ask questions about any codebase — straight from Claude Code, Cursor, and other AI assistants.** Point Bytebell at a repo and your AI tools can answer _"where is auth handled?"_ or _"how does caching work here?"_ with real, grounded answers from the actual code.

Everything runs on your machine. Nothing leaves it except the calls to the model you choose — no telemetry, no phone-home.

By default Bytebell runs in **embedded mode**: SQLite + LadybugDB + Honker, all in local files under `~/.bytebell` — **no database to install, no Docker to run.** (Prefer Mongo + Neo4j + Redis in Docker? See [Docker mode](#docker-mode) below.)

---

## What you need

- **[Bun](https://bun.sh)** ≥ 1.1 — `curl -fsSL https://bun.sh/install | bash`
- **An LLM backend** — either an [OpenRouter](https://openrouter.ai) API key (best quality) or a local [Ollama](https://ollama.com) model (free). Every per-file analysis call goes through the one you pick.
- **git**

> Embedded mode needs **no database and no Docker**. (Today the one-line installer below still checks for Docker — if you don't have it, use the [manual install](#manual-install-no-docker), which needs none.)

---

## 1 · Install (~1 min)

```bash
curl -fsSL https://raw.githubusercontent.com/ByteBell/open-ir/main/install.sh | bash
```

It checks prerequisites, clones the repo, installs dependencies, and links the `bytebell` command. Verify:

```bash
bytebell --help
```

<a id="manual-install-no-docker"></a>

> **Manual install (no Docker):**
> `git clone https://github.com/ByteBell/open-ir && cd open-ir && bun install && cd packages/cli && bun link`

---

## 2 · Run setup (~2 min)

```bash
bytebell setup
```

> Run it directly in a terminal — it's interactive.

The wizard asks a few quick things, then takes over:

1. **LLM provider** — OpenRouter (paste an API key + model like `anthropic/claude-sonnet-4.6`) or a local Ollama model (free).
2. **Infrastructure** — **Embedded (no Docker)** is the default and recommended: SQLite + LadybugDB + Honker, all local files. Or choose **Docker** (Mongo + Neo4j + Redis).
3. **Repo** — paste a GitHub URL to index now, or skip and add one later. Private repo? It'll ask for a token. Want a specific branch? It'll let you pick.

From there it runs on its own — **boots Bytebell, indexes your repo, and shows live progress.** The part that feels like magic:

> **It detects your coding tools** — Claude Code, Cursor, Claude Desktop, Windsurf, VS Code — and wires Bytebell into each one for you (backing up each config first). No copy-pasting connection strings.

---

## 3 · Ask your codebase

When setup finishes you'll see something like:

```
✓ Bytebell running (embedded — no Docker)
✓ Repo indexed
✓ Connected to Cursor & Claude Code
```

**Restart your editor**, then ask your assistant:

- _"Where is authentication implemented in this repo?"_
- _"Summarize the architecture."_
- _"How does caching work here, and where's it configured?"_
- _"What happens when a request hits the `/index` route?"_
- _"Which files would I touch to add a new CLI command?"_

The assistant calls Bytebell's retrieval tools behind the scenes and answers from your actual code.

> If your editor wasn't auto-detected, connect it once by hand:
> `claude mcp add --transport http bytebell http://127.0.0.1:8080/mcp`

> **A note on time:** install + setup is ~2–3 minutes. _Indexing_ runs in the background and scales with repo size — a small/medium repo is ready in a few minutes. A repo is ready to query once `bytebell ls` shows it as **PROCESSED**.

---

## Everyday commands

| You want to…            | Run                                            |
| ----------------------- | ---------------------------------------------- |
| Add another repo        | `bytebell index https://github.com/owner/repo` |
| …a private one          | `bytebell index <url> --token <github-pat>`    |
| …a specific branch      | `bytebell index <url> --branch <name>`         |
| Index a local folder    | `bytebell ingest /path/to/source`              |
| Check what's ready      | `bytebell ls`                                  |
| See token usage & cost  | `bytebell stats`                               |
| Re-connect your editors | `bytebell mcp install`                         |
| Change a setting        | `bytebell set <key> <value>`                   |
| Start everything again  | `bytebell boot`                                |
| Stop it                 | `bytebell shutdown`                            |

Full reference: [commands.md](commands.md). All settings: [configuration.md](configuration.md).

---

<a id="docker-mode"></a>

## Running with Docker instead (optional)

**Everything above uses embedded mode — the recommended default, no Docker.** You only need this section if you'd rather run the server databases (Mongo + Neo4j + Redis).

Choose **Docker** at the infrastructure step of `bytebell setup`, or switch any time:

```bash
bytebell set db-provider mongo
bytebell set graph-provider neo4j
bytebell set queue-provider bullmq
```

Then `bytebell boot` brings up the local Docker stack (`bytebell-mongo`, `bytebell-neo4j`, `bytebell-redis`) with named volumes, waits for healthchecks, and starts the server. Docker Desktop / engine must be running.

Already run your own Mongo / Neo4j / Redis? Set their connection details first (`bytebell set mongo …`, `neo4j …`, `redis …`) and `bytebell boot` skips the containers for any service you've configured. See [configuration.md](configuration.md).

<details>
<summary><strong>Under the hood</strong> (optional — you don't need this to use Bytebell)</summary>

### Local-first & private

There's no `.env` file and no telemetry. All config lives in `~/.bytebell/config.json` (mode `0600`), written only by `bytebell set`. The only outbound network calls go to the LLM backend you picked (OpenRouter or your Ollama URL).

### What setup actually starts

- **Embedded mode** (default): no Docker. The doc store, graph, and queue live in local files under `~/.bytebell` (`data.sqlite`, `ladybug.lbug`, `queue.db`). The server runs on `http://127.0.0.1:8080` (MCP at `/mcp`).
- **Docker mode**: a local stack via Docker (MongoDB, Neo4j, Redis) in named volumes, plus the same server. First boot pulls images and can take a couple of minutes.

### Indexing lifecycle

`bytebell ls` shows each repo moving through `CREATED → QUEUED → INGESTED → PROCESSING → PROCESSED` (or `FAILED`, with a reason). Per-file analysis runs through your chosen model; `bytebell stats` shows the token cost.

### Full reference

Every command, flag, and option: [commands.md](commands.md). Architecture and design: [arch.md](arch.md).

</details>

---

## If something's off

- **"Docker is installed but not running"** (during install or Docker-mode boot) — start Docker Desktop, then re-run. For a Docker-free setup, use the [manual install](#manual-install-no-docker) and keep the embedded default.
- **Server won't start / "infra not reachable"** (Docker mode) — Docker isn't up yet, or a port (8080, or a DB port) is taken. Setup offers to reuse or remap a conflicting port; otherwise free it and re-run.
- **`bytebell setup` says it needs a terminal** — don't pipe it; run it directly.
- **Private repo won't index** — your token needs `repo` scope.
- **Editor returns nothing yet** — the repo is still indexing. Wait for `PROCESSED` in `bytebell ls`.
