# Changelog

All notable changes to Bytebell are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Embedded infrastructure mode (default) — no Docker.** SQLite (doc store), LadybugDB (graph), and Honker (SQLite-backed queue) run from local files under `~/.bytebell`. `bytebell setup` defaults to embedded; `bytebell boot` skips Docker when no provider needs a container.
- **Pluggable providers**, settable via `bytebell set` or the setup form: `db-provider` (`mongo`|`sqlite`), `graph-provider` (`neo4j`|`ladybug`), `queue-provider` (`bullmq`|`honker`), `ingestion-strategy` (`flat-folder`|`concept-graph`).
- **`concept-graph` ingestion strategy** — adds `:Concept`, `:Contract`, and `:Guidepost` semantic nodes via per-file MCP enrichment, alongside the default `flat-folder` strategy.
- **`bytebell migrate paths`** — reconciles the legacy on-disk layout with the commit-scoped layout (`--dry-run` supported).
- **`bytebell mcp install`** (auto-wire the MCP endpoint into detected editors) and the **`list_knowledge`** MCP tool.

### Changed

- The active ingestion strategy is now `flat-folder` (default) / `concept-graph`; the earlier `BasicFileAnalysisStrategy` is archived.

## [0.1.0] — 2026-05-08

### Added

- Initial public release.
- `bytebell-server` HTTP daemon (Express 5) with ingestion routes (`/api/v1/...`) and MCP transport (`/mcp`, HTTP + SSE).
- `bytebell` CLI (Ink/React TUI + commander) with subcommands: `set`, `setup`, `boot`, `shutdown`, `server`, `index`, `ingest`, `pull`, `ls`, `delete`, `stats`, `mcp`, `migrate`.
- GitHub repository ingestion via `BasicFileAnalysisStrategy` (file-walk + per-file LLM analysis).
- MCP retrieval tools: `smart_search`, `keyword_lookup`, `retrieve_file` .
- Token-usage telemetry persisted to MongoDB (`mcp_activity`, `usage_summary`); live USD estimate against OpenRouter pricing via `bytebell stats`.
- Local-first single-tenant architecture (`orgId="local"`); BYO MongoDB + Neo4j + Redis.
- Configuration via `~/.bytebell/config.json` (no `.env`), managed through `bytebell set <key> <value>`.
- BullMQ in-process workers with retryable, idempotent jobs.
- Winston structured logging to `~/.bytebell/logs/` plus stdout.

### License

- AGPL-3.0-only with an additional non-commercial clause. See [LICENSE](LICENSE).
