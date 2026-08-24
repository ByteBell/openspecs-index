# Bytebell

**[bytebell.ai](https://bytebell.ai)** — a local-first code knowledge engine. Index any repo into a durable graph and query it from your LLM client over MCP, without sending the source anywhere you don't control.

## Quickstart

> Looking for the full CLI reference? Every `bytebell` subcommand, flag, and option lives in **[commands.md](commands.md)**. The Quickstart below is the minimum sequence from zero to a queryable graph.

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1 — runtime + workspace manager.
- [Docker](https://www.docker.com/) — for the local Mongo + Neo4j + Redis stack `bytebell boot` brings up. Not needed if you point Bytebell at infrastructure you already run (`bytebell set infra-mode cloud`, see [Bring your own infrastructure](#bring-your-own-infrastructure)).
- An LLM backend — one of six: [OpenRouter](https://openrouter.ai) (default), [Anthropic](https://console.anthropic.com), [Google Gemini](https://aistudio.google.com/apikey), [OpenAI](https://platform.openai.com) or any OpenAI-compatible gateway, [AWS Bedrock](https://console.aws.amazon.com/bedrock), or a local [Ollama](https://ollama.com) model. Every per-file analysis call goes through the one you pick — full comparison in [docs/llm-providers.md](docs/llm-providers.md).

### Install

One command — checks prerequisites, clones the repo, installs dependencies, and links the `bytebell` binary:

```bash
curl -fsSL https://raw.githubusercontent.com/ByteBell/open-ir/main/install.sh | bash
```

Verify with `bytebell --help`. (Manual install steps are in [commands.md](commands.md).)

### Fastest path: `bytebell setup`

```bash
bytebell setup
```

One interactive command does everything the manual steps below automate: picks your LLM provider, auto-fills and boots the local stack, optionally indexes a repo (handling private-repo tokens and branch selection), and **auto-wires the MCP endpoint into your editor**. See [SETUP.md](SETUP.md) for the full walkthrough.

The sections below are the manual, step-by-step equivalent — useful if you want to configure each piece yourself or bring your own infrastructure.

### Configure

Pick an LLM backend and give it credentials. OpenRouter is the default, so this is the shortest path:

```bash
bytebell set openrouter-api-key sk-or-…
bytebell set openrouter-model anthropic/claude-sonnet-4.6
```

Any of the other five works the same way — set `llm-provider`, then that provider's keys:

```bash
bytebell set llm-provider anthropic       # openrouter | anthropic | gemini | openai | bedrock | ollama
bytebell set anthropic-api-key sk-ant-…
bytebell set anthropic-model claude-sonnet-5
```

| Provider               | Keys to set                                                                                     | Cost reporting | Tool use                       |
| ---------------------- | ----------------------------------------------------------------------------------------------- | -------------- | ------------------------------ |
| `openrouter` (default) | `openrouter-api-key`, `openrouter-model`                                                        | **real spend** | yes                            |
| `anthropic`            | `anthropic-api-key`, `anthropic-model`                                                          | `$0`           | yes                            |
| `gemini`               | `gemini-api-key`, `gemini-model`                                                                | `$0`           | yes                            |
| `openai`               | `openai-api-key`, `openai-model` (+ `openai-base-url` for vLLM / LiteLLM / a gateway)           | `$0`           | yes                            |
| `bedrock`              | `bedrock-region`, `bedrock-model` + either `bedrock-api-key` or AWS SigV4 creds / instance role | `$0`           | yes (needs the bearer API key) |
| `ollama`               | `ollama-url`, `ollama-model`                                                                    | `$0` (local)   | no                             |

Only OpenRouter reports real spend, so `bytebell stats` shows `$0` for the rest — a deliberate choice over a hardcoded price table that silently rots. Ollama is the one backend without tool use: OpenAI-tool-format support varies per locally-pulled model and can't be checked ahead of time.

Or skip this step and run `bytebell boot` straight away — on an interactive terminal it opens a setup form to collect provider and credentials on first run. Running `bytebell set` with no arguments opens the same form at any time.

There is no `.env` file anywhere. `~/.bytebell/config.json` (mode `0600`) is the single source of truth, and `bytebell set` is the only sanctioned way to write to it. If you already run Mongo / Neo4j / Redis and don't want the Docker stack, see [Bring your own infrastructure](#bring-your-own-infrastructure) below.

### Boot

```bash
bytebell boot
```

What happens, in order:

1. **Pre-flight check** — verifies the infra keys (`mongo`, `neo4j`, `neo4j-user`, `neo4j-password`, `redis`) plus whichever credentials your selected `llm-provider` requires. If anything is blank and you're in an interactive terminal, Bytebell opens a setup form so you can enter it on the spot, then continues. In a non-interactive context (CI, piped input) it prints the exact `bytebell set …` commands and exits.
2. **Auto-fill** — in `infra-mode docker` (the default), fills any missing infra config keys with local-Docker defaults and generates a Neo4j password if one isn't set. In `infra-mode cloud` nothing is auto-filled — your own URIs stand as written.
3. **Stack up** — docker mode only: `docker compose up -d` brings up `bytebell-mongo`, `bytebell-neo4j`, `bytebell-redis` (named volumes — data persists across reboots).
4. **Health gate** — docker mode only: polls `docker compose ps` until all three services report `healthy`.
5. **Server up** — spawns `bytebell-server` (HTTP on `127.0.0.1:8080`, MCP at `/mcp`).

Steps 2–4 are governed by `infra-mode`, which is `docker` unless you change it. Setting your own `mongo` / `neo4j` / `redis` URIs does **not** by itself skip Docker — run `bytebell set infra-mode cloud` as well. (A third mode, `embedded`, exists in the config schema but is currently disabled in the CLI.)

First boot pulls images and can take a couple of minutes. Subsequent boots are fast.

### Index a repo

```bash
bytebell index https://github.com/anthropics/claude-code
# private repo: add --token <github-pat>; never paste the PAT positionally
bytebell ls   # watch state: CREATED → QUEUED → INGESTED → PROCESSING → PROCESSED
```

When the row reads `PROCESSED`, the graph is fully populated and the MCP tools will return results for that repo. Two other states can show up: `HALTED` (paused mid-run, retryable) and `CORRUPTED` (the source tree went missing). Local directories work too: `bytebell ingest /path/to/source-tree`.

### Connect an MCP client

Easiest: **`bytebell mcp install`** auto-detects your installed tools — Claude Code, Cursor, Claude Desktop, Windsurf, VS Code — and writes the correct MCP entry into each one's config (the JSON shape differs per tool; the command handles that and backs up the file first). `bytebell setup` runs this for you on first boot.

To wire Claude Code by hand:

```bash
claude mcp add --transport http bytebell http://127.0.0.1:8080/mcp
```

Or add this under the `mcpServers` key of Claude Desktop's config (or Cursor's `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "bytebell": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp"
    }
  }
}
```

The server registers four tools — `list_knowledge`, `smart_search`, `keyword_lookup`, `retrieve_file` — plus a bundled skill at `bytebell://skills/index` that the client can fetch and install once per session for the recommended workflow.

## What Bytebell does

You point `bytebell` at a repo. It clones the source, walks every file, and for each file calls your configured LLM provider to extract a structured `FileAnalysis`: a one-paragraph **purpose**, a longer **summary** of what the file does and how it fits the architecture, a **business context** line tying it to the product domain, plus the file's classes, functions, keywords, imports, and a set of domain/contract fields (ontology concepts, business entities, system capabilities, side effects, config dependencies, data-flow direction, integration surface, provided/consumed contracts, and a section map).

Those outputs are persisted into two stores:

- **Neo4j** receives a `:File` node enriched with `purpose`, `summary`, `businessContext`, `language`, `sha`, and `sizeBytes`, linked via `:HAS_CLASS`, `:HAS_FUNCTION`, `:HAS_KEYWORD`, `:HAS_IMPORT_INTERNAL`, and `:HAS_IMPORT_EXTERNAL` to deduplicated child nodes shared across the whole graph. Fulltext indexes cover purpose+summary, business context, keyword names, and class/function signatures.
- **MongoDB** receives the raw file content, language, SHA256, and the full `FileAnalysis` JSON for cite-back and exact retrieval.

LLM clients then query that graph through four MCP tools — `list_knowledge`, `smart_search`, `keyword_lookup`, `retrieve_file` — which together cover repo discovery, fused semantic + structural search, reverse entity-to-file lookup, and targeted content reads. They let an agent answer questions like _"Which files implement our retry/backoff policy and where is it configured?"_ without reading the entire repo into context.

```mermaid
flowchart LR
    CLI["bytebell CLI / TUI"] -- HTTP --> Server["bytebell-server<br/>(Express)"]
    Client["MCP-capable LLM client<br/>Claude Code, Cursor, …"] -- MCP --> Server
    Server -- enqueues --> Q["BullMQ in-process worker"]
    Q --> Strategy["IngestionStrategy<br/>per-file LLM"]
    Strategy -- LLM call --> OR["LLM provider<br/>OpenRouter · Anthropic · Gemini<br/>OpenAI · Bedrock · Ollama"]
    Strategy -- raw + analysis --> Mongo[("MongoDB")]
    Strategy -- enriched node --> Neo[("Neo4j")]
    Server -. retrieval .-> Mongo
    Server -. retrieval .-> Neo
```

## Who this is for

- **Solo engineers and small teams** who want a Claude / Cursor / Continue session to _actually_ know their codebase — not just whatever the tool can fit in a context window — without sending source to a third party.
- **OSS communities and academic research groups** who need a durable, reproducible code-knowledge index they can re-index from a single command.
- **Anyone running an MCP-capable agent on a private codebase** where compliance, IP, or just personal preference rules out hosted RAG-over-your-repo SaaS.

It is **not** a hosted product, not a chat UI, and not a multi-tenant platform. There is exactly one tenant — `orgId="local"` — and the server binds to `127.0.0.1`. If you want hosted, multi-tenant, or commercial-use rights, see the [Enterprise](#enterprise) section.

## How it works

### Ingest

`bytebell index <url>` (or `bytebell ingest <path>`) submits a job to an in-process BullMQ queue. The worker dispatches to an `IngestStrategy` — today the `flat-folder` pipeline ([packages/ingest-strategies/src/flat-folder/](packages/ingest-strategies/src/flat-folder/), documented in [docs/flat-folder-strategy.md](docs/flat-folder-strategy.md)): scan + classify, per-file LLM analysis, backfill, folder summaries, a repo summary, then the graph write.

The repo is cloned under `~/.bytebell/orgs/<orgId>/<provider>/<knowledgeId>/<owner>/<repo>/<commit>/repository/`, every file gets a per-file LLM call, and raw content lands in Mongo while the enriched node lands in Neo4j.

The per-file LLM call returns a single JSON object with this shape:

```jsonc
{
  "purpose": "Why this file exists. Max ~300 tokens.",
  "summary": "What it does, key patterns, architecture role. Max ~600 tokens.",
  "businessContext": "Product/domain impact. 2–3 lines, max ~100 tokens.",
  "language": "typescript",
  "classes": ["ExactName (~L3-29): What it represents", "..."],
  "functions": ["exact_name (~L42-58): Primary responsibility", "..."],
  "keywords": ["domain-term-1", "domain-term-2", "..."],
  "importsInternal": ["./relative/paths.ts", "..."],
  "importsExternal": ["express", "neo4j-driver", "..."],
  "ontologyConcepts": ["retry-policy", "..."],
  "businessEntities": ["Invoice", "..."],
  "systemCapabilities": ["queue-submission", "..."],
  "sideEffects": ["writes to Mongo", "..."],
  "configDependencies": ["redis-url", "..."],
  "dataFlowDirection": "inbound | outbound | bidirectional | none",
  "integrationSurface": ["POST /api/v1/github/index", "..."],
  "contractsProvided": ["buildGithubIndexRoute()", "..."],
  "contractsConsumed": ["@bb/queue submitJob()", "..."],
  "sectionMap": [{ "name": "route handler", "description": "..." }],
}
```

The full field list lives in [packages/ingest-core/src/prompts/file-analysis-fields.ts](packages/ingest-core/src/prompts/file-analysis-fields.ts). `classes` and `functions` carry approximate line ranges so `retrieve_file` can later pull the right slice without re-reading the whole file. **Re-indexing is diff-aware**: `bytebell pull` diffs the previously-indexed commit against branch HEAD and re-analyses only the files git reports as added, modified, or renamed. LLM cost is proportional to actual code churn, not to repo size.

### Graph shape

```mermaid
graph LR
    K[":Knowledge"]
    R[":Repo"]
    Fo[":Folder"]
    RS[":RepoSummary"]
    F[":File<br/>purpose, summary,<br/>businessContext"]
    FV[":FileVersion"]
    KW[":Keyword"]
    C[":Class"]
    Fn[":Function"]
    M[":Module"]
    K -- HAS_FILE --> F
    K -- HAS_REPO --> R
    K -- HAS_REPO_SUMMARY --> RS
    R -- CONTAINS --> Fo
    Fo -- CONTAINS --> F
    Fo -- CONTAINS_FOLDER --> Fo
    F -- HAS_VERSION --> FV
    F -- HAS_KEYWORD --> KW
    F -- HAS_CLASS --> C
    F -- HAS_FUNCTION --> Fn
    F -- HAS_IMPORT_INTERNAL --> M
    F -- HAS_IMPORT_EXTERNAL --> M
```

One `:Knowledge` node per indexed repo owns its `:File` nodes. Each `:File` carries `purpose`, `summary`, `businessContext`, `language`, `sha`, `sizeBytes`, a `relativePath` unique within its `knowledgeId`, and the domain/contract fields listed above (`ontologyConcepts`, `businessEntities`, `sideEffects`, `contractsProvided`/`contractsConsumed`, the section map, and the big-file chunk counters). From every file, the five `:HAS_*` edges link to deduplicated `:Keyword`, `:Class`, `:Function`, and `:Module` nodes that are global across the whole graph — the same library, the same exported function, the same domain term resolves to one node no matter how many repos reference it. The ingest pipeline additionally builds the `:Repo` / `:Folder` tree and a `:RepoSummary`; `:FileVersion` nodes retain per-commit history. Constraints make `(knowledgeId, relativePath)` unique on `:File`; fulltext indexes back the natural-language search side. Source: [packages/neo4j/src/files.ts](packages/neo4j/src/files.ts), [packages/neo4j/src/folder.ts](packages/neo4j/src/folder.ts), [packages/neo4j/src/indexes.ts](packages/neo4j/src/indexes.ts).

A parallel legacy mirror (`:FileNode`, `:FolderNode`, `:OrgKeyword`, written with snake_case properties) is upserted alongside the primary labels for backwards compatibility.

There are no cross-file **call** edges in the current schema — that's a deliberate tradeoff for ingestion simplicity and language-agnostic ingest. Future strategies will add them, plugged in behind the same `IngestStrategy` interface.

### Retrieval

Four MCP tools, registered at `http://127.0.0.1:8080/mcp`:

- **`list_knowledge(page?)`** — enumerate indexed repos with their `knowledgeId` UUIDs, state, and file counts. Call this first whenever you need a `knowledgeId`; never guess one from a repo name.
- **`smart_search(query, knowledgeId?, knowledgeIds?, path?, exclude?, page?, pageSize?)`** — fused **eight-channel** search across File `purpose`+`summary`, `businessContext`, paths, keyword names, class signatures, function signatures, internal imports, and external imports. Returns a deduplicated, ranked, paginated list of files with folder clustering (`pageSize` defaults to 30, max 100). `exclude` drops `tests | vendor | config | generated | docs | build`. Use first.
- **`keyword_lookup(term)`** — reverse lookup. A search term resolves to all matching named entities (keywords, classes, functions, module names) and the files linked to each.
- **`retrieve_file`** — three operations: `metadata` (purpose, summary, businessContext, classes/functions with line ranges, imports; up to 10 paths per call), `content` (read specific line ranges or search within one file with surrounding context), `bulk_search` (parallel scan of up to 50 files for a string).

```mermaid
flowchart TD
    Q["Question from agent"] --> LK["list_knowledge<br/>→ knowledgeId"]
    LK --> SS["smart_search"]
    SS --> KL["keyword_lookup<br/>(optional)"]
    SS --> RM["retrieve_file metadata<br/>→ class/function line ranges"]
    KL --> RM
    RM --> RC["retrieve_file content<br/>→ exact line slice"]
    RC --> A["Cited answer"]
```

Most well-formed code questions resolve in 2–4 tool calls. No re-clone, no full-file dumps, no embeddings round-trip.

## Day-to-day commands

| Command                                                       | Purpose                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bytebell setup`                                              | Interactive first-run wizard: provider, boot, optional index, MCP auto-install.    |
| `bytebell index <url>`                                        | Index a GitHub repo (`--token` for private, `--branch` to pick a branch).          |
| `bytebell ingest <path>`                                      | Index a local directory instead of a remote repo.                                  |
| `bytebell ls`                                                 | List indexed knowledge entries with state.                                         |
| `bytebell stats`                                              | Ingestion totals, per-repo breakdown, per-commit token usage.                      |
| `bytebell mcp install`                                        | Auto-detect installed editors and register the MCP endpoint in their config.       |
| `bytebell mcp stats`                                          | MCP usage: input/output tokens, monthly breakdown.                                 |
| `bytebell pull`                                               | Re-index a previously-added GitHub repo at branch HEAD (diff-aware).               |
| `bytebell delete`                                             | Picker; cancels jobs, drops the Knowledge subgraph from Neo4j, removes Mongo rows. |
| `bytebell shutdown`                                           | Stop the server. Docker keeps running.                                             |
| `bytebell boot`                                               | Warm restart.                                                                      |
| `bytebell migrate paths`                                      | One-off on-disk layout migration for repos indexed by an older version.            |
| `docker compose -f infra/docker/docker-compose.yml down [-v]` | Stop containers (and optionally drop volumes — destroys all indexed data).         |

Full reference, including every flag and option: [commands.md](commands.md).

## Bring your own infrastructure

By default, `bytebell boot` provisions a local Docker stack (`bytebell-mongo`, `bytebell-neo4j`, `bytebell-redis`) with auto-generated credentials — that is `infra-mode docker`, the default. If you already run Mongo, Neo4j, and Redis (or want to use a managed service), switch the mode **and** set the connection details:

```bash
bytebell set infra-mode     cloud
bytebell set mongo          mongodb://user:pass@host:27017/bytebell
bytebell set neo4j          bolt://host:7687
bytebell set neo4j-user     neo4j
bytebell set neo4j-password <your-password>
bytebell set redis          redis://host:6379
```

`infra-mode cloud` is what actually skips Docker — setting the URIs alone leaves the mode at `docker` and the compose stack still comes up. In cloud mode nothing is auto-filled, so every connection value above must be set explicitly, and Docker is not required on the host. See the [Configuration reference](#configuration-reference) for the full key list.

## Architecture at a glance

A single Bun-built Express daemon, `bytebell-server`, hosts the ingestion HTTP routes (`/api/v1/…`), the MCP transport (Streamable HTTP at `/mcp`, SSE at `/sse`), and the BullMQ workers all in-process, bound to `127.0.0.1`. The CLI is a thin Ink/React TUI that talks HTTP to that daemon for every day-to-day operation — the one exception is `bytebell migrate paths`, an offline maintenance command that opens Mongo directly. Workers run in the server's lifecycle; there is no separate worker fleet.

Package tiers, import direction, the state machine, and the architectural rules every PR is held to live in [CLAUDE.md](CLAUDE.md). Subsystem deep-dives live in [docs/llm-providers.md](docs/llm-providers.md) and [docs/flat-folder-strategy.md](docs/flat-folder-strategy.md).

## Configuration reference

Settings live in `~/.bytebell/config.json` and are written exclusively by `bytebell set <key> <value>` (or by first-run auto-fill on `bytebell boot`). Run `bytebell set` with no arguments for the interactive form. The key you pass to `bytebell set` is not always the config.json field name — the table below is the authoritative CLI-key list.

**Infrastructure**

| Key              | Purpose                                        | Default                                                           |
| ---------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `infra-mode`     | `docker` (compose stack) or `cloud` (your own) | `docker`                                                          |
| `mongo`          | MongoDB connection string                      | _(blank; docker mode fills `mongodb://127.0.0.1:27017/bytebell`)_ |
| `neo4j`          | Neo4j Bolt URI                                 | _(blank; docker mode fills `bolt://127.0.0.1:7687`)_              |
| `neo4j-user`     | Neo4j auth user                                | _(blank; docker mode fills `neo4j`)_                              |
| `neo4j-password` | Neo4j auth password                            | _(generated on first docker boot)_                                |
| `redis`          | Redis URL for BullMQ                           | _(blank; docker mode fills `redis://127.0.0.1:6379`)_             |
| `port`           | Local HTTP/MCP port                            | `8080`                                                            |

**LLM provider** — set `llm-provider`, then the keys for that provider only.

| Key                                                               | Purpose                                                            | Default                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `llm-provider`                                                    | `openrouter \| anthropic \| gemini \| openai \| bedrock \| ollama` | `openrouter`                        |
| `openrouter-api-key`                                              | OpenRouter key                                                     | _(required for OpenRouter)_         |
| `openrouter-model`                                                | Model slug used for analysis                                       | `deepseek/deepseek-v4-flash`        |
| `openrouter-fallback-model-1` … `-4`                              | Models OpenRouter falls back to, in order                          | four preset slugs                   |
| `anthropic-api-key`, `anthropic-model`                            | Anthropic direct                                                   | _(blank)_                           |
| `gemini-api-key`, `gemini-model`                                  | Google Gemini                                                      | _(blank)_                           |
| `openai-api-key`, `openai-model`, `openai-base-url`               | OpenAI or any OpenAI-compatible gateway                            | _(blank)_                           |
| `bedrock-api-key`, `bedrock-region`, `bedrock-model`              | AWS Bedrock (bearer key path)                                      | _(blank)_                           |
| `aws-access-key-id`, `aws-secret-access-key`, `aws-session-token` | Bedrock via SigV4 instead of a bearer key                          | _(blank; instance role also works)_ |
| `ollama-url`, `ollama-model`                                      | Local Ollama daemon                                                | _(blank)_                           |
| `llm_cache_enabled`                                               | Reuse cached per-file analyses                                     | `true`                              |

**Ingestion + storage backends**

| Key                                            | Purpose                                              | Default   |
| ---------------------------------------------- | ---------------------------------------------------- | --------- |
| `concurrency.github`                           | Concurrent files analysed per GitHub job             | `2`       |
| `db-provider`                                  | Document store implementation                        | `mongo`   |
| `graph-provider`                               | Graph store implementation                           | `neo4j`   |
| `queue-provider`                               | Queue implementation                                 | `bullmq`  |
| `sqlite-path`, `queue-db-path`, `ladybug-path` | Paths used by the (currently disabled) embedded mode | _(blank)_ |

**Logging**

| Key                  | Purpose             | Default |
| -------------------- | ------------------- | ------- |
| `log-level`          | Winston log level   | `info`  |
| `log-retention-days` | Daily log retention | `14`    |

A further set of tuning fields (`enrichment.*`, `skip.decision.*`, `context.window.limit`, `neo4j.batch.size`, `openrouter.reasoning.max.tokens`, …) exists in the schema with sensible defaults but has no `bytebell set` key — see [packages/config/src/schema.ts](packages/config/src/schema.ts) for the complete list.

If a required setting is missing, Bytebell either opens the setup form (interactive terminal) or prints the exact `bytebell set …` command and refuses to boot (non-interactive). It never silently reads `process.env`.

## Why this design — research grounding

> Comparing Bytebell to PageIndex, GitNexus, GraphRAG, Sourcegraph, or Augment Code? See **[comparison.md](comparison.md)** for a side-by-side feature table and pros / cons of each.

Bytebell's shape — _build a code graph at ingest time, enrich every node with LLM-derived structured semantics, then serve retrieval against the joined surface_ — tracks a converging body of recent work showing that purely structural retrieval (AST / call-graph) and purely semantic retrieval (embeddings) each leave large performance on the table, and that combining them at indexing time unlocks the gains.

**Graphs beat flat retrieval for code.** Repository-level graphs from AST + imports + call structure consistently outperform flat embedding retrieval on real engineering tasks.

- RepoGraph ([2410.14684](https://arxiv.org/abs/2410.14684), ICLR 2025) — +32.8% on SWE-bench.
- CodexGraph ([2408.03910](https://arxiv.org/abs/2408.03910), NAACL 2025) — agents query a code graph DB; beats similarity-only retrieval.
- CGM ([2505.16901](https://arxiv.org/abs/2505.16901)) — graph + node semantics; 43% on SWE-bench Lite.
- Citation-Grounded Code Comprehension ([2512.12117](https://arxiv.org/abs/2512.12117)) — argues LLM-only and embedding-only both fail; hybrid wins.

**LLM-generated semantic enrichment closes the vocabulary gap.** Identifiers and call edges don't capture intent — natural-language summaries on each node let retrieval match what a developer _means_, not just what the code _spells_.

- Tram ([2305.11074](https://arxiv.org/abs/2305.11074), ACL 2023) — semantic enrichment beats flat sentence-level retrieval.
- LLM Agents Improve Semantic Code Search ([2408.11058](https://arxiv.org/abs/2408.11058)) — LLM-injected metadata improves embedding-based retrieval.
- Knowledge-Graph-Based Repo-Level Code Generation ([2505.14394](https://arxiv.org/abs/2505.14394)) — graph captures structure; LLM context fills semantic gaps.
- Sense and Sensitivity ([2505.13353](https://arxiv.org/abs/2505.13353)) — lexical and semantic recall are different capabilities; supports the `summary` (semantic) vs Mongo raw (lexical) split.

**Structured summaries and hierarchy beat blob summarization.** Explicit fields — purpose, inputs, outputs, business context — aggregated bottom-up let retrieval match at the right level of abstraction. This maps directly onto Bytebell's `purpose` / `summary` / `businessContext` schema.

- Hierarchical Repo-Level Code Summarization for Business Applications ([2501.07857](https://arxiv.org/abs/2501.07857), ICSE LLM4Code 2025) — closest motivational match: structured per-unit summaries aggregated to file/package level, grounded in business context.
- Beyond Function Level ([2502.16704](https://arxiv.org/abs/2502.16704)) — class/repo context in summaries beats function-only.
- Code-Craft ([2504.08975](https://arxiv.org/abs/2504.08975)) — closest published peer; bottom-up LLM summaries from a code graph; +82% top-1 retrieval precision on 7,531 functions.
- Hierarchical Summarization (Springer 2025) — project/dir/file summaries at indexing time; Pass@10 of 0.89 on real Jira issues, beats flat retrieval and standard RAG.

**Hybrid structure + semantics, served as memory.** The most recent work converges on serving the joined graph through a memory-style retrieval interface — exactly what MCP gives us.

- Codebase-Memory ([2603.27277](https://arxiv.org/abs/2603.27277)) — MCP-served knowledge graph with LLM-derived metadata; reports 10× token reduction.

The design choices follow directly: each `:File` node carries LLM-generated semantics alongside `:HAS_CLASS` / `:HAS_FUNCTION` / `:HAS_KEYWORD` / `:HAS_IMPORT_*` edges (structure), and the MCP retrieval tools fuse both surfaces at query time.

## Enterprise

Bytebell-public is the OSS edition. ByteBell also offers a separately-licensed **Enterprise** edition for organizations that need a commercial-use grant, hardening, and direct support. Enterprise typically includes:

- A commercial-use grant covering use by or on behalf of for-profit entities, including SaaS deployments and revenue-generating applications.
- Hardened multi-tenant deployment patterns, SSO / SCIM, audit logging, and data-isolation guarantees.
- Additional ingestion strategies (cross-file call graphs, dependency-graph extraction, PDF and design-doc ingestion) and additional MCP tools.
- Access to the managed ByteBell knowledge surface and connectors to internal sources (Confluence, Jira, Notion, GitHub Enterprise, …).
- Engineering support and SLAs for production deployments.

To discuss Enterprise licensing, evaluation, or services, contact `team@bytebell.ai`.

## Contributing

Hooks, commit conventions, and pre-push gates are documented in [contributing.md](contributing.md). Architectural rules — file-size limits, tier boundaries, the `README.md` requirement, the Bun-only constraint, and the provider-table rule that keeps LLM backends out of call-site conditionals — live in [CLAUDE.md](CLAUDE.md) and apply to every PR.

## License

Bytebell is released under **AGPL-3.0 with an additional non-commercial use clause** — see [LICENSE](LICENSE) for the authoritative text. Personal, academic, research, and non-profit use are unrestricted under AGPL-3.0 (network-copyleft applies). **Commercial use** is governed by license terms and is covered by the [Enterprise edition](#enterprise) (`team@bytebell.ai`). The running server itself does **not** verify a license; governance is by license terms, not by code. The server is meant for local single-tenant use — no remote network surface; everything binds to `127.0.0.1`.
