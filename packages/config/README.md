# `@bb/config` — context

## Tier

Infrastructure. May depend on Kernel (`@bb/types`, when it exists) and external
packages (`zod`). May be imported by every higher tier (Strategy, Domain,
Binaries).

## Responsibility

Single source of truth for runtime settings stored in
`~/.bytebell/config.json`. Owns:

- Path resolution for `~/.bytebell/` and `config.json`
- Schema (Zod, strict mode) + typed `Config` enum
- First-run materialization of a default `config.json`
- Memoized in-process load
- Atomic, validating writes via `setConfigValue`
- Required-field completeness check with CLI-hint strings

This package does **not** read from `process.env` and never will.

`setBytebellHomeResolver` registers an override function invoked on every
`getBytebellHome()` call (no caching). The resolver returns the home directory
to use for the current invocation, or `null` to fall through to the
`~/.bytebell` default. Pass `null` to clear.

`seedConfig` injects a pre-parsed config object into the in-memory cache,
validated through `configSchema.parse`. When seeded, `loadConfig()` returns
the seeded values and **does not** call `ensureBytebellHome()` or read
`config.json`. The cache invalidator is also no-op while seeded, so the seed
survives unexpected `__notifyConfigChanged` events. `setConfigValue` throws
`ConfigSeededError` when invoked against a seeded cache — writes are disabled
in that mode. When `seedConfig` is never called, behaviour is bit-for-bit the
disk-backed path: `loadConfig()` materializes `~/.bytebell/config.json` on
first read and `setConfigValue` performs atomic writes.

The `Config` enum lives in `@bb/types`; `ConfigIncompleteError` lives in
`@bb/errors`. Both are imported from those packages directly, not from
`@bb/config`.

Config keys (v0): `server_port`, `mongo_uri`, `neo4j_uri`, `neo4j_user`,
`neo4j_password`, `redis_url`, `openrouter_api_key`, `openrouter_model`,
`openrouter_fallback_model_1..4`, `concurrency.github`, `log_level`,
`log_retention_days`, `llm_cache_enabled`, `llm_provider` (`openrouter`
default | `ollama`), `ollama_url` (default `http://localhost:11434`),
`ollama_model` (free-form, empty default — user picks any model their
local Ollama daemon has pulled).

Infra-provider keys (the active backend triple): `db_provider`
(`sqlite` **default** | `mongo`), `graph_provider` (`ladybug` **default** |
`neo4j`), `queue_provider` (`honker` **default** | `bullmq`). The defaults
form the **embedded** preset — SQLite + Ladybug + Honker, zero Docker and no
Redis. `infraRequiredKeys(infra)` derives which connection/path keys are
mandatory from this triple, and is the single source of truth shared by the
CLI preflight and the server boot check (so embedded installs are never asked
for a Mongo/Neo4j/Redis URL). Embedded store paths (`sqlite_path`,
`ladybug_path`, `queue_db_path`) default empty and are auto-filled under
`~/.bytebell` on boot.

Ingestion-strategy keys (ConceptGraphStrategy): `ingestion.strategy`
(`flat-folder` default | `concept-graph`), `enrichment.model` (empty
default — strategy refuses to start if unset and `ingestion.strategy
= concept-graph`), `enrichment.max.tool.calls.per.file` (15),
`enrichment.max.iterations.per.file` (8),
`enrichment.wall.time.ms.per.file` (400000),
`enrichment.concurrency` (16),
`enrichment.max.tool.result.chars` (20000 — truncation cap for MCP tool
results passed back to the LLM).

Anything not in this list is internal — do not import from subpaths.

## Data ownership

- `~/.bytebell/` directory creation (mode `0700`)
- `~/.bytebell/config.json` content + atomic writes (mode `0600`)
- Default values for every config key

This package does **not** own:

- `~/.bytebell/install_id` — assigned to a later package
- `~/.bytebell/keys.json` — out of scope for v0
- `~/.bytebell/logs/` — `@bb/logger`
- `~/.bytebell/cost-ledger.sqlite` — `@bb/llm`

## Invariants

1. **No env var reads.** Source files contain no `process.env` references.
   Enforced at lint time ([eslint.config.mjs:71-94](../../eslint.config.mjs#L71-L94)).
2. **No `.env` / `dotenv` / `BYTEBELL_HOME`.** Programmatic override seams
   are `__setBytebellHomeForTests` (test-only, static) and
   `setBytebellHomeResolver` (per-call function).
3. **Strict schema.** Unknown keys in `config.json` cause `loadConfig()` to
   throw — typo defense.
4. **Defaults always present.** `loadConfig()` never returns a partial config;
   missing required fields surface as empty strings, surfaced via
   `isConfigComplete()` rather than thrown by the loader.
5. **Atomic writes.** Every write is `tmp → fsync → rename`. A crash mid-write
   leaves the previous `config.json` intact.
6. **File mode `0600`.** `config.json` contains the OpenRouter API key in
   plaintext (v0 decision); the file is owner-read/write only.
7. **No public file paths besides home + config.** Other files under
   `~/.bytebell/` are not addressed by this package.

## External dependencies

- `zod` — runtime schema + parsing
- Node built-ins — `node:fs`, `node:os`, `node:path`

No HTTP, no DB, no logger. This package boots before everything else.

## What is intentionally out of scope

- `install_id` generation/reading (deferred ownership)
- OS keychain / `keys.json` / encrypted secrets
- Logger initialization
- A `bytebell set` CLI command (lives in `@bb/cli`; uses `setConfigValue`
  primitive)

## How to extend

To add a new config key:

1. Add a new `Config` enum entry in `src/schema.ts`.
2. Add the field to `configSchema` with a `.default(...)`.
3. Add a `ConfigValueMap` entry mapping the enum to its TS type.
4. If required, add the enum to `REQUIRED_KEYS` (infra-always) or to
   `PROVIDER_REQUIRED_KEYS[<provider>]` (provider-specific — driven by
   `Config.LlmProvider` at completeness-check time).
5. Add a hint string to `HINTS`.
6. Add cases to `readField` and `writeField`.
7. Update this `README.md` if the new key changes invariants or ownership.
