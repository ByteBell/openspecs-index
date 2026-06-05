# Testing Checklist — `default` branch vs `main`

This branch merges the **embedded prerelease**: 176 files, ~8,200 insertions. The
headline change is that **the default infrastructure flips from Docker
(Mongo/Neo4j/Redis) to embedded (SQLite + Ladybug + Honker)**, plus a one-command
install, a `setup` wizard, and automatic MCP client configuration.

Use this as a manual QA pass before merging. Items are ordered by priority — the
new defaults are what every new user hits first, so test those before anything
else.

---

## ⚠️ Highest-priority items (the new defaults)

- [ ] **Fresh install with zero Docker.** On a machine with no Mongo/Neo4j/Redis
      and Docker _not_ running, a brand-new config must boot. Confirm
      `db_provider=sqlite`, `graph_provider=ladybug`, `queue_provider=honker`
      are the defaults (`packages/config/src/schema.ts`) and that boot prints
      `embedded mode — no Docker required`.
- [ ] **Embedded MCP search actually returns results.** The make-or-break test.
      Ingest a repo in embedded mode, then call `smart_search`, `keyword_lookup`,
      `list_knowledge`, and `retrieve_file`. Ladybug search is `CONTAINS`-based
      (not fulltext) — verify each tool returns non-empty, relevant results, not
      errors or empty sets. Compare the _same_ queries against Neo4j mode to
      gauge ranking differences.
- [ ] **The three embedded files get created and persist:** `~/.bytebell/data.sqlite`,
      `~/.bytebell/ladybug.lbug`, `~/.bytebell/queue.db`. Restart the server and
      confirm indexed data survives.
- [ ] **Provider-aware boot preflight.** In embedded mode the server must _not_
      demand `mongo_uri` / `neo4j_*` / `redis_url`. Unset each embedded path
      (`sqlite_path`, `ladybug_path`, `queue_db_path`) and confirm boot fails
      with a clear error naming the missing key.

---

## 1. One-command install (`install.sh`, `SETUP.md`)

- [ ] `install.sh` detects missing Bun / git and prints install links.
- [ ] It clones the repo (skips if present), runs `bun install --frozen-lockfile`,
      and links `bytebell` onto PATH.
- [ ] `bytebell --help` works after install; final message points to `bytebell setup`.
- [ ] Docker is **not** a prerequisite anymore (embedded default) — verify the
      script doesn't hard-fail when Docker is absent.

## 2. Setup wizard (`bytebell setup`)

- [ ] Requires an interactive TTY; piped/CI input is handled gracefully.
- [ ] Stage order: LLM provider → infra mode → credentials → optional repo index → confirmation.
- [ ] **Infra mode defaults to "embedded (recommended)"** (changed from docker).
- [ ] OpenRouter path requires API key + model; Ollama path requires URL + model.
- [ ] Confirmation screen masks the API key.
- [ ] After apply: config written, server boots, `mcp install` runs, and (if a repo
      URL was given) indexing polls to `PROCESSED`.
- [ ] `Esc` cancels cleanly at any stage.

## 3. Config keys & provider switching (`bytebell set`)

New keys (set via `bytebell set <key> <value>`; bare key with no value **toggles**):

| Key                                              | Values              | Default         |
| ------------------------------------------------ | ------------------- | --------------- |
| `db-provider`                                    | `sqlite` ↔ `mongo`  | `sqlite`        |
| `graph-provider`                                 | `ladybug` ↔ `neo4j` | `ladybug`       |
| `queue-provider`                                 | `honker` ↔ `bullmq` | `honker`        |
| `sqlite-path` / `ladybug-path` / `queue-db-path` | file paths          | `~/.bytebell/*` |

- [ ] `bytebell set db-provider mongo` flips to mongo and **auto-fills** `mongo_uri`.
- [ ] `bytebell set graph-provider neo4j` auto-fills `neo4j_uri/user/password`
      (random password generated).
- [ ] `bytebell set queue-provider bullmq` auto-fills `redis_url`.
- [ ] Bare toggle (`bytebell set queue-provider` with no value) flips to the other value.
- [ ] If a `set mode <embedded|docker>` preset exists, it sets all three providers
      atomically and fills their defaults — verify both presets.
- [ ] Confirm the in-flight change in `packages/config/src/schema.ts` is committed/
      intended before merging (currently shows as modified in the working tree).

## 4. Docker mode (regression — must still work)

- [ ] Switch to docker mode and confirm Mongo/Neo4j/Redis come up via
      `infra/docker/docker-compose.yml`.
- [ ] Ingest a repo end-to-end; all four MCP tools return results (the established
      baseline for search quality).
- [ ] `bytebell shutdown --with-docker` stops containers; `--keep-docker` leaves
      them; embedded mode ignores both flags.
- [ ] Port-conflict handling on boot (reuse / kill / change port) behaves sanely.

## 5. Queue providers + crash recovery

- [ ] Honker (file-based, no Redis) queues and processes ingestion jobs in embedded mode.
- [ ] BullMQ still works after switching `queue-provider bullmq` (Redis required).
- [ ] **Orphan resumer:** kill the server mid-ingest with a doc stuck in `QUEUED`,
      restart, and confirm it logs a resume and the job completes
      (`resumeOrphans()` in `packages/queue/src/resumer.ts`).

## 6. Path migration (`bytebell migrate paths`)

- [ ] `bytebell migrate paths --dry-run` reports moves without touching disk.
- [ ] Real run moves legacy `~/.bytebell/repos/<id>` + `.meta/<id>` into the
      commit-scoped `orgs/<org>/<provider>/<id>/<owner>/<repo>/<commit>/` layout.
- [ ] Legacy dir with **no DB record** → reported as `abandoned` (deleted).
- [ ] DB record but **missing commitId/repoUrl** → `skippedNoCommit` /
      `skippedNoRepoUrl`, data preserved.
- [ ] **Boot-time auto-reconcile:** server runs migration at startup and _refuses
      to boot_ (`LayoutMigrationRequiredError`) if a record exists but can't be
      migrated — verify it does not silently delete data.

## 7. Automatic MCP install (`bytebell mcp install`)

- [ ] Auto-detects installed clients and writes the correct JSON shape per target:
  - Claude Code (`~/.claude.json`) & Claude Desktop & VS Code (`servers` key) → `{type:"http", url}`
  - Cursor → `{url}` only
  - Windsurf → `{serverUrl}` (note the different key name)
- [ ] Creates a `.bytebell.bak` backup before modifying each config; preserves
      existing `mcpServers`/`servers` entries.
- [ ] Interactive multi-select (all detected pre-checked); non-interactive
      configures all detected.
- [ ] No clients detected → prints the manual
      `claude mcp add --transport http bytebell http://127.0.0.1:8080/mcp` fallback.
- [ ] Restart a client and confirm the bytebell tools actually appear and respond.

## 8. Ingestion performance (Neo4j batch writes)

- [ ] Ingest a large repo (1k+ files) in Neo4j mode; confirm batched transactional
      upserts (`upsertFileNodesBatch` in `packages/neo4j/src/files-batch.ts`) and
      that the final graph (keywords/classes/functions edges) matches per-file
      behavior — no dropped relationships.
