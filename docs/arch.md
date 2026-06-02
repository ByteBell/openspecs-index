# Bytebell — Architecture

> **Status: review draft.** This document was reconstructed from [CLAUDE.md](../CLAUDE.md) (the authoritative source for _intent_) and the current package layout. Several package `README.md` files link here with line numbers from an earlier version of this file; those anchors should be re-pointed to the section headings below. Treat CLAUDE.md as authoritative wherever the two disagree, and update both in the same PR.

Bytebell-public is an open-source, **single-tenant, local-first** knowledge engine. It ingests source repositories into a durable knowledge graph and serves them through an MCP retrieval surface — all from a single Bun process on the user's own machine. There is exactly one tenant (`orgId="local"`), no auth, and no outbound calls except to the user-selected LLM backend.

This document describes **what** the system is and **why** it is shaped this way. The enforceable rules (file size, tier boundaries, env-var policy, license) live in [CLAUDE.md](../CLAUDE.md); the command surface lives in [commands.md](commands.md); settings live in [configuration.md](configuration.md).

---

## System shape

The system ships **two deployables** from one Bun workspace:

- **`bytebell-server`** — a single Express daemon that hosts the ingestion HTTP routes, the MCP transport (Streamable HTTP + SSE), and the BullMQ workers, all in one process. It binds to `127.0.0.1`.
- **`bytebell`** — an Ink/React terminal UI driven by commander subcommands. It is a thin HTTP client over the server; it never touches Mongo, Neo4j, or Redis directly.

```
TUI / HTTP client → Express (bytebell-server) → BullMQ (in-process) → IngestionStrategy → Graph + Storage
                                              ↘ MCP tools → Neo4j / Mongo retrieval
```

The two binaries **never import each other** — they communicate only over HTTP. This boundary is enforced by an ESLint rule. Workers run inside the server's lifecycle; there is no separate worker fleet.

---

## Package tiers

Packages live under `packages/*` with `@bb/*` names, arranged in tiers. **Imports flow downward only** — a higher tier may depend on a lower tier, never the reverse, and siblings do not import each other unless the dependency is modelled in `package.json`.

```
Binaries          server, cli
        ↑
Domain            mcp, ingest-github, ingest-business-context
        ↑
Strategy          queue (+ provider backends)
        ↑
Cross-cutting     llm
        ↑
Infrastructure    config, logger, mongo, neo4j, redis (+ alternate backends)
        ↑
Kernel            types, errors
```

`@bb/server` and `@bb/cli` are the only composition roots. They contain no business logic — they wire packages together. All logic lives in domain or strategy packages.

### Provider seam

Several infrastructure and strategy concerns are pluggable behind a provider abstraction, selected by configuration rather than by code change:

- **Document store** — `db-provider`: Mongo (default) or SQLite.
- **Graph store** — `graph-provider`: Neo4j (default) or LadybugDB.
- **Queue** — `queue-provider`: BullMQ (default) or Honker.
- **Ingestion strategy** — `ingestion-strategy`: flat-folder (default) or concept-graph.
- **LLM backend** — `llm-provider`: OpenRouter (default) or Ollama.

A disabled provider degrades gracefully — it does not throw at import time. See [configuration.md](configuration.md) for the keys and defaults.

---

## Ingestion pipeline

Ingestion is **asynchronous**. A request enqueues a BullMQ job; the in-process worker dispatches to the active `IngestionStrategy`.

1. **Submit** — `bytebell index <url>` (remote) or `bytebell ingest <path>` (local directory) posts to the server, which validates the payload and enqueues a job.
2. **Clone / read** — the worker clones the repo into `~/.bytebell/` (commit-scoped layout) or reads the local tree.
3. **Analyse** — the strategy walks every file and, for each, calls the LLM backend to extract a structured `FileAnalysis`: a one-paragraph **purpose**, a longer **summary**, a **business-context** line, plus classes, functions, keywords, and imports.
4. **Persist** — raw file content + the full analysis JSON go to the document store; an enriched node + its `:HAS_*` edges go to the graph store.
5. **Transition** — the knowledge entry's state is persisted before the next phase begins.

Re-indexing is **diff-aware**: `bytebell pull` compares each file's content hash against the prior stored hash and re-analyses only changed files, so LLM cost tracks code churn, not repository size.

New ingestion shapes (AST extraction, dependency-graph extraction) arrive as **new strategies behind the same interface**, never as ad-hoc forks of the worker.

---

## Processing state machine

```
CREATED → QUEUED → INGESTED → PROCESSING → PROCESSED
                                         ↘ FAILED
```

States are explicit enums, never inferred from side effects. Every transition is persisted before the next phase begins. The lifecycle is surfaced by `bytebell ls` and the dashboard's Repos pane. Jobs are idempotent and retryable; retries do not duplicate side effects.

---

## HTTP route catalogue

All routes are local and unauthenticated (single-tenant, `orgId="local"`); the CLI resolves every command to one of these. Source: [routes.ts](../packages/server/src/routes.ts).

| Route                             | Purpose                                           |
| --------------------------------- | ------------------------------------------------- |
| `GET /health`                     | Liveness probe                                    |
| `POST /api/v1/github/index`       | Enqueue a remote-repo ingestion job               |
| `POST /api/v1/github/probe`       | Check repo access and resolve the default branch  |
| `POST /api/v1/github/pull`        | Enqueue a diff-aware re-index against branch HEAD |
| `GET /api/v1/github/<id>/commits` | Recent commit history for a knowledge entry       |
| `POST /api/v1/local/index`        | Enqueue ingestion of a local directory            |
| `GET /api/v1/repos`               | List knowledge entries with state                 |
| `GET /api/v1/repos/<id>`          | Poll one entry's ingestion progress               |
| `DELETE /api/v1/repos/<id>`       | Remove an entry from all stores + pending jobs    |
| `GET /api/v1/stats`               | Ingestion totals, per-repo and per-commit usage   |
| `GET /api/v1/mcp/stats`           | MCP request + token usage                         |
| `POST/GET/DELETE /mcp`            | MCP transport (Streamable HTTP)                   |
| `GET /sse`, `POST /sse/messages`  | Legacy MCP SSE transport                          |

---

## Retrieval surface

MCP-capable clients query the joined graph + document surface through four tools registered at `/mcp` (source: [packages/mcp/src](../packages/mcp/src)):

- **`list_knowledge`** — enumerate the indexed repos and their `knowledgeId`s. Call first.
- **`smart_search`** — fused multi-channel search across purpose/summary, business context, paths, keyword names, class/function signatures, and module imports. Returns ranked, deduplicated files. Use first for content questions.
- **`keyword_lookup`** — reverse lookup from a term to the named entities (keywords, classes, functions, modules) and the files linked to each.
- **`retrieve_file`** — targeted reads: metadata, specific line ranges, or a parallel scan across many files.

Most well-formed code questions resolve in a few tool calls — no re-clone, no full-file dumps.

---

## Data ownership & local layout

- **Document store** owns raw file content, language, content hash, and the full `FileAnalysis` JSON (for cite-back and exact retrieval).
- **Graph store** owns the `:File` nodes and their deduplicated `:Keyword` / `:Class` / `:Function` / `:Module` children, shared across the whole graph.
- **Redis** backs the queue and transient state.
- **`~/.bytebell/`** holds config, logs, the local install id, cloned source trees, and the server PID. It is the single source of runtime truth — there is no `.env` file.

Knowledge entities are immutable once `PROCESSED`: new versions are written, never mutated in place.

---

## Distribution

Bytebell is **BYO-infra**: the user runs Mongo, Neo4j, and Redis (or lets `bytebell boot` provision a local Docker stack). The engine makes no telemetry or phone-home calls. Distribution is a single Bun process plus the user's chosen data stores — there is no hosted control plane in the OSS edition.

For the enforceable contribution rules and invariants, see [CLAUDE.md](../CLAUDE.md).
