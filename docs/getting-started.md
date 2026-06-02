# Bytebell

**Ask questions about any codebase — straight from Claude Code, Cursor, and other
AI assistants.** Point Bytebell at a repo, and your AI tools can suddenly answer
"where is auth handled?" or "how does caching work here?" with real, grounded
answers from the actual code.

Everything runs on your machine. Nothing leaves it except the calls to the model
you choose — no telemetry, no phone-home.

---

## The whole thing, in 4 steps

1. **Install** Bytebell
2. **Pick a model** (OpenRouter or local Ollama)
3. **Choose a repo** to make searchable
4. **Ask about it** in your editor

One command (`bytebell setup`) does steps 2–4 for you, including wiring itself into
your editor automatically. Most people are querying their code in a couple of minutes.

---

## 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/ByteBell/open-ir/main/install.sh | bash
```

You'll need a few common tools first — the installer checks for them and tells you
if anything's missing:

- **[Bun](https://bun.sh)** — `curl -fsSL https://bun.sh/install | bash`
- **[Docker Desktop](https://www.docker.com/products/docker-desktop)**, running — Bytebell uses it to start its local store the first time. You never manage it directly.
- **git**

> Prefer to do it by hand? `git clone https://github.com/ByteBell/open-ir && cd open-ir && bun install && cd packages/cli && bun link`

Check it's there: `bytebell --help`

---

## 2. Run setup — one command handles everything

```bash
bytebell setup
```

> Run it directly in a terminal (it's interactive).

It asks you three quick things, then takes over:

- **Which model?** OpenRouter (paste an API key + model like `anthropic/claude-sonnet-4.6`) or a local Ollama model (free).
- **Which repo?** Paste a GitHub URL to index now, or skip and add one later. Private repo? It'll ask for a token. Want a specific branch? It'll let you pick.
- **Confirm.**

From there it runs on its own — starting Bytebell, indexing your repo, and showing
live progress for each phase. The part that makes it feel like magic:

> **It detects your coding tools** — Claude Code, Cursor, Claude Desktop, Windsurf,
> VS Code — and wires Bytebell into them for you (with a backup of each config).
> No copy-pasting connection strings.

---

## You're done

When setup finishes you'll see something like:

```
✓ Bytebell running
✓ Repo indexed
✓ Connected to Cursor & Claude Code
```

**Restart your editor**, then try asking your assistant:

- _"Where is authentication implemented in this repo?"_
- _"Summarize the architecture."_
- _"How does caching work here, and where's it configured?"_
- _"What happens when a request hits the `/index` route?"_
- _"Which files would I touch to add a new CLI command?"_

The assistant calls Bytebell's retrieval tools behind the scenes and answers from
your actual code.

> If your editor wasn't auto-detected, connect it once by hand:
> `claude mcp add --transport http bytebell http://127.0.0.1:8080/mcp`

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

A repo is ready to query once `bytebell ls` shows it as **PROCESSED**.

---

<details>
<summary><strong>Under the hood</strong> (optional — you don't need this to use Bytebell)</summary>

### Local-first & private

There's no `.env` file and no telemetry. All config lives in
`~/.bytebell/config.json` (mode `0600`), written only by `bytebell set`. The only
outbound network calls go to the LLM backend you picked (OpenRouter or your Ollama URL).

### What setup actually starts

On first boot, Bytebell brings up a small local stack via Docker (MongoDB, Neo4j,
Redis) and a server on `http://127.0.0.1:8080` (the MCP endpoint is `/mcp`). Data
lives in named volumes and `~/.bytebell/`, so it persists across reboots. First boot
pulls images and can take a couple of minutes; later boots are quick.

### Bring your own infrastructure

Already running Mongo / Neo4j / Redis and don't want the Docker stack? Point Bytebell
at your own instances instead — see **Bring your own infrastructure** in
[README.md](README.md). (`bytebell boot` skips any service whose config you've already set.)

### Indexing lifecycle

`bytebell ls` shows each repo moving through:
`CREATED → QUEUED → INGESTED → PROCESSING → PROCESSED` (or `FAILED`, with a reason).
Per-file analysis runs through your chosen model; `bytebell stats` shows the token
cost.

### Full reference

Every command, flag, and option: [commands.md](commands.md). Architecture and design:
[docs/arch.md](docs/arch.md).

</details>

---

## If something's off

- **"Docker is installed but not running"** — start Docker Desktop, then re-run.
- **Server won't start / "infra not reachable"** — Docker isn't up yet, or a port
  (8080, or a DB port) is taken. Setup offers to reuse or remap a conflicting port;
  otherwise free it and re-run `bytebell setup`.
- **`bytebell setup` says it needs a terminal** — don't pipe it; run it directly.
- **Private repo won't index** — your token needs `repo` scope.
- **Editor returns nothing yet** — the repo is still indexing. Wait for `PROCESSED`
  in `bytebell ls`.
