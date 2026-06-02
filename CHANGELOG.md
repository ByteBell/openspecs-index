# Changelog

All notable changes to Bytebell are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
