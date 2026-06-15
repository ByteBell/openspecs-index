# OpenSpecs Configuration Reference

Every OpenSpecs setting lives in `~/.bytebell/config.json` (mode `0600`) — the single source of truth. There is **no `.env` file** anywhere (see [CLAUDE.md](../CLAUDE.md) "Rule of Env Vars"); the server reads `config.json` directly and never reads `process.env`.

The only sanctioned write path is:

```bash
bytebell set <key> <value>
bytebell set                 # no args → opens the interactive setup form
```

Values are validated before they are persisted. Keys are defined in [keyMap.ts](../packages/cli/src/keyMap.ts); defaults come from [schema.ts](../packages/config/src/schema.ts). If a required setting is missing, OpenSpecs either opens the setup form (interactive terminal) or prints the exact `bytebell set …` command and refuses to boot.

> **Boot auto-fill (Docker mode):** when the Mongo/Neo4j/Redis keys are blank, `bytebell boot` fills them with local defaults (and generates a Neo4j password) before starting the containers. You only set them yourself when bringing your own infrastructure.

---

## Infrastructure presets

OpenSpecs runs in one of two presets, **derived from the `db-provider` / `graph-provider` / `queue-provider` keys** — there is no separate "mode" setting:

| Preset                   | db / graph / queue            | Docker? | Stores                          |
| ------------------------ | ----------------------------- | ------- | ------------------------------- |
| **`embedded`** (default) | `sqlite` / `ladybug` / `honker` | **No**  | Local files under `~/.bytebell` |
| **`docker`**             | `mongo` / `neo4j` / `bullmq`  | Yes     | Containers (or your own)        |

`bytebell setup` lets you pick a preset and sets all three keys at once. Switching to embedded also auto-fills the store paths when they're blank: `sqlite-path` → `~/.bytebell/data.sqlite`, `ladybug-path` → `~/.bytebell/ladybug.lbug`, `queue-db-path` → `~/.bytebell/queue.db`. On `bytebell boot`, Docker is started only for the providers that need it (embedded → none).

---

## Docker-mode infrastructure

These apply only in **Docker mode** (or when bringing your own Mongo / Neo4j / Redis). The default **embedded** stack uses none of them — its stores are local files (see [Storage & queue backends](#storage--queue-backends)). `port` is the local server / MCP port and applies to both modes.

| Key              | Sets                    | Default                          | Notes                          |
| ---------------- | ----------------------- | -------------------------------- | ------------------------------ |
| `mongo`          | MongoDB connection URI  | _(blank → boot auto-fills local)_ |                                |
| `neo4j`          | Neo4j Bolt URI          | _(blank → boot auto-fills local)_ |                                |
| `neo4j-user`     | Neo4j auth user         | _(blank → boot auto-fills `neo4j`)_ |                              |
| `neo4j-password` | Neo4j auth password     | _(generated on first boot)_      | **redacted** in output         |
| `redis`          | Redis URL for BullMQ    | _(blank → boot auto-fills local)_ |                                |
| `port`           | Local HTTP/MCP port     | `8080`                           | integer 1–65535                |

## LLM provider

| Key                           | Sets                                   | Default                      | Notes                       |
| ----------------------------- | -------------------------------------- | ---------------------------- | --------------------------- |
| `llm-provider`                | Active backend                         | `openrouter`                 | toggle: `openrouter` ⇄ `ollama` |
| `openrouter-api-key`          | OpenRouter API key                     | _(required, blank)_          | **redacted** in output      |
| `openrouter-model`            | OpenRouter model slug for analysis     | `deepseek/deepseek-v4-flash` |                             |
| `openrouter-fallback-model-1` | First fallback model                   | `qwen/qwen3.5-flash-02-23`   |                             |
| `openrouter-fallback-model-2` | Second fallback model                  | `minimax/minimax-m2.7`       |                             |
| `openrouter-fallback-model-3` | Third fallback model                   | `moonshotai/kimi-k2.5`       |                             |
| `openrouter-fallback-model-4` | Fourth fallback model                  | `x-ai/grok-4.3`              |                             |
| `ollama-url`                  | Ollama server URL (when provider=ollama) | `http://localhost:11434`   |                             |
| `ollama-model`                | Ollama model (any locally-pulled model) | _(blank)_                  |                             |
| `llm_cache_enabled`           | Cache LLM responses                    | `true`                       | `true` or `false`           |

## Logging & concurrency

| Key                  | Sets                                | Default | Notes                |
| -------------------- | ----------------------------------- | ------- | -------------------- |
| `log-level`          | Winston log level                   | `info`  | one of `LOG_LEVELS`  |
| `log-retention-days` | Daily log retention                 | `14`    | positive integer     |
| `concurrency.github` | Concurrent files analysed per job   | `2`     | positive integer     |

## Storage & queue backends

`bytebell setup` configures the **embedded** stack — the default: `sqlite` / `ladybug` / `honker`, all local files. (If you skip `setup`, the raw config fallback is the Docker stack: `mongo` / `neo4j` / `bullmq`.)

| Key                  | Sets                            | Default (embedded)         | Toggle                          |
| -------------------- | ------------------------------- | -------------------------- | ------------------------------- |
| `db-provider`        | Document store backend          | **`sqlite`**               | `sqlite` ⇄ `mongo`              |
| `graph-provider`     | Graph store backend             | **`ladybug`**              | `ladybug` ⇄ `neo4j`             |
| `queue-provider`     | Job queue backend               | **`honker`**               | `honker` ⇄ `bullmq`             |
| `ingestion-strategy` | Active ingestion strategy       | `flat-folder`              | `flat-folder` ⇄ `concept-graph` |
| `sqlite-path`        | SQLite DB path (embedded)       | `~/.bytebell/data.sqlite`  | auto-filled by setup            |
| `ladybug-path`       | LadybugDB path (embedded)       | `~/.bytebell/ladybug.lbug` | auto-filled by setup            |
| `queue-db-path`      | Honker queue DB path (embedded) | `~/.bytebell/queue.db`     | auto-filled by setup            |

---

**Toggle keys** (marked above) accept their listed values and also flip to the other value when you run `bytebell set <key>` with no value. **Redacted** keys are masked when configuration is printed back.

For the commands that read and write these settings, see [commands.md](commands.md).
