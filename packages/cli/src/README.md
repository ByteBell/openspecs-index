# `@bb/cli/src` — context

Implementation of `@bb/cli`. See [../README.md](../README.md) for the
package-level contract; this file documents how the source tree is split.

## Files

- **[index.ts](index.ts)** — binary entry. Shebang `#!/usr/bin/env bun`.
  A bare `bytebell-tinker` (no argv beyond node + script) calls `runMenu()` to
  open the interactive TUI menu; anything else (a subcommand, `--help`,
  `--version`) is built via `buildProgram()` and handed to `parseAsync`.
  Top-level `try/catch` prints any uncaught error and exits `2` (the
  typed-error path through commander handlers exits `1`).
- **[program.ts](program.ts)** — `buildProgram()` constructs the
  commander `Command("bytebell-tinker")`, wires `VERSION`, and registers every
  shipped subcommand: `set`, `boot`, `shutdown`, `server`, `index`,
  `ingest`, `pull`, `ls`, `delete`, `stats`, `mcp`, `migrate`, `menu`.
  Extracted from `index.ts` so `MenuCommand` can build a fresh program
  to dispatch a chosen command. Single source of truth for the command
  list. Also re-exports `VERSION` (from `version.ts`).
- **[version.ts](version.ts)** — leaf module exporting the `VERSION`
  string, shared by `program.ts` and the menu footer. Separate file to
  avoid an `index ↔ program ↔ MenuCommand` import cycle.
- **[MenuCommand.ts](MenuCommand.ts)** — the `menu` subcommand and the
  `runMenu()` orchestrator (also the default when `bytebell-tinker` is run
  with no args). Owns the `GROUPS` layout (SETUP / KNOWLEDGE / SERVER /
  INSIGHTS), the `ARG_SPECS` table (which commands need positional args
  prompted), and `DISPATCH` (menu id → argv, e.g. `mcp` → `mcp stats`).
  **Loops**: every command / form returns to the menu so the user moves
  back and forth between options; the loop ends only on quit. Flow per
  iteration: render `<MenuSelector />` → on `configure-llm` render
  `<LlmConfigForm />`; on an arg-taking command render `<ArgPrompt />`
  then dispatch; otherwise dispatch immediately. `dispatch()` builds a
  fresh `buildProgram()` and `parseAsync`es `[node, script, cmd, ...args]`.
  **Keys:** `q` backs out of a sub-screen to the menu; `Esc` leaves the
  TUI entirely (on the text-entry screens — arg prompt, LLM fields — Esc
  backs out instead, since `q` is typed there).
- **[MenuSelector.tsx](MenuSelector.tsx)** — the top-level command picker.
  Takes grouped `MenuGroup[]`; renders labelled sections with a per-item
  glyph, but the cursor walks a single flat order skipping headers.
  ↑/↓ or j/k move (wrapping), Enter selects, Esc/q quit (root level).
  Header is the cyan `Bytebell Tinker` wordmark + dim
  `local knowledge engine · open-ir` subtitle; footer is a
  `<ControlsBar />` with the version right-aligned.
- **[ControlsBar.tsx](ControlsBar.tsx)** — the universal footer key legend.
  Renders each `{ keys, label }` as a bold inverse "cap" (`ACCENT` cyan bg
  / white) plus a bold white label, so the control hints look identical on
  every screen. Adds no outer padding (callers place it); an optional
  `version` is pushed dim-right via `space-between`. Used by `MenuSelector`,
  `ArgPrompt`, and both phases of `LlmConfigForm`.
- **[theme.ts](theme.ts)** — single-source brand accent for the **whole**
  CLI. Exports `ACCENT` (`cyan`, Bytebell accent — an Ink colour for
  cursors / active rows / form highlights / control caps) **and** `ANSI`
  (raw truecolor escapes) so the non-Ink output path (`output.ts`
  spinners, tables, progress bars) draws from the same palette. Every
  command — Ink or plain stdout — is themed from here.
- **[LlmConfigForm.tsx](LlmConfigForm.tsx)** — dedicated two-phase form
  for the LLM provider config. Phase 1 (`ProviderPicker`): choose
  openrouter or ollama. Phase 2 (`FieldsForm`): edit just that provider's
  fields — OpenRouter API key (masked) + model, or Ollama URL + model —
  via Ink's focus manager (Tab/Shift-Tab), Enter saves all rows through
  `KEY_MAP` setters (`llm-provider` plus the field keys), Esc steps back
  to the provider choice. Pre-filled from `getConfigValue`.
- **[ArgPrompt.tsx](ArgPrompt.tsx)** — one-field-at-a-time positional-arg
  collector for menu-launched commands (`index` → git-url, `ingest` →
  optional path). Enter advances / submits, Esc returns to the menu,
  required fields refuse to advance while empty.
- **[SetCommand.ts](SetCommand.ts)** — the `set` subcommand. Two
  optional positional args. Both provided → headless flow: looks up
  `KEY_MAP[key]`, runs `entry.setter(value)`, prints success (or the
  redacted form for password-bearing keys). Neither provided → renders
  `<SetupForm />` via `ink.render`. Mismatched args → friendly error.
- **[keyMap.ts](keyMap.ts)** — the dispatch table from CLI key strings
  to typed `setConfigValue<K>` calls. Each entry is a closure that owns
  its own type narrowing — no `as` casts at the call site. Local
  helpers `parsePort` / `parsePositiveInt` / `parseLogLevel` throw
  `Error("Invalid value for \"<key>\": …")` which `SetCommand` pretty-
  prints with the matching `bytebell set …` hint from `@bb/config`'s
  `HINTS`. Carries entries for every config key the user can set
  headlessly today, including `openrouter-api-key` (`redact: true`)
  and `openrouter-model` (plain text).
- **[BootCommand.ts](BootCommand.ts)** — the `boot` subcommand.
  Sequence: `ensurePreflight` (if openrouter api-key/model are blank,
  renders `<SetupForm />` when stdin+stdout are a TTY so the user can
  fill them in-place; falls back to the legacy print-`HINTS`-and-exit
  path on non-TTY for CI) → `applyInfraDefaults` (auto-fills the
  blank infra keys, generates a random Neo4j password if needed) →
  `dockerInfra.up` (writes `.env`, runs compose, polls health) →
  `ensureServerRunning` (existing helper that lazy-spawns the server
  and polls `/health`). Prints a final ready banner with the MCP URL.
  Idempotent — re-running on an already-up stack is a fast no-op.
- **[ShutdownCommand.ts](ShutdownCommand.ts)** — the `shutdown`
  subcommand. Delegates the actual stop to `serverLifecycle.stopServer()`
  (see below), then handles the Docker side: prints the explicit
  `docker compose down` hint, or tears infra down when `--with-docker`
  (or the interactive prompt) says so. Skips all Docker handling in
  embedded mode (`isEmbedded()`). On a timed-out stop it exits 1 without
  escalating to `SIGKILL`; on no running server it reports "server is not
  running" and exits 0.
- **[serverLifecycle.ts](serverLifecycle.ts)** — `stopServer()` /
  `startServer()` shared by `shutdown`/`server`. `stopServer` resolves the
  target pids from **two sources** — the live process(es) holding the
  configured server port (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`) plus a
  still-alive pid from `~/.bytebell/pid` — so a stale pid file (a
  double-start where the loser died on the port-bind conflict without
  unlinking) no longer hides the real server. SIGTERMs each, polls until
  **no process holds the port** (≤ 30 s), and unlinks any leftover pid
  file. Returns `{ wasRunning, timedOut, pid }`.
- **[bootConfig.ts](bootConfig.ts)** — `applyInfraDefaults` writes
  local-docker defaults (mongo / neo4j / neo4j-user / redis) and a
  random base64url 24-byte Neo4j password into `~/.bytebell/config.json`
  via `KEY_MAP[key].setter`, but only for keys that are currently
  blank. Returns the resolved Neo4j password (whether freshly
  generated or pre-existing) so `BootCommand` can pass it into
  `dockerInfra.up`. `checkPreflight` reads `openrouter_api_key` and
  `openrouter_model` and returns the missing entries with their
  `Config` enum value (so `BootCommand` can look up the right hint).
- **[dockerInfra.ts](dockerInfra.ts)** — wraps `docker compose -f
<abs>/infra/docker/docker-compose.yml up -d` (stdout/stderr
  inherited so the user sees pulls + start), then polls
  `docker compose ps --format json` every 2 s for ≤ 90 s until all
  three services report `Health: healthy`. Resolves the compose path
  via `import.meta.url` so it works under `bun link`. Writes
  `infra/docker/.env` (mode `0600`) with `NEO4J_PASSWORD=<value>`
  before `up`. Typed errors: `DockerNotFoundError` (no `docker` on
  PATH), `DockerComposeError` (non-zero compose exit), and
  `DockerHealthTimeoutError` (services still not healthy after the
  poll budget). `parsePsOutput` accepts both the JSON-array and
  newline-delimited-JSON formats compose ships across versions.
- **[output.ts](output.ts)** — three small print helpers:
  `success(line)`, `error(line, hint?)`, `list(label, items)`. Manual
  ANSI escapes wrapped behind a `stream.isTTY` check. Plain text on
  non-TTY (CI, pipes).
- **[McpCommand.ts](McpCommand.ts)** — the `mcp` subcommand group.
  `mcp stats` renders `/api/v1/mcp/stats` (global + per-identity token
  usage). `mcp install` delegates to `runMcpInstall` (below).
- **[mcpInstall.ts](mcpInstall.ts)** — orchestrator for `mcp install`.
  Resolves the endpoint URL from `Config.ServerPort`, filters
  `MCP_TARGETS` by `detect()`, prompts (interactive multi-select on a
  TTY; auto-selects all detected when stdin is not a TTY), then
  **merges** a `bytebell` entry into each picked tool's config and
  prints a result table. Merge is non-destructive: reads existing JSON
  (`{}` on ENOENT), backs up to `<file>.bytebell.bak`, injects only the
  `bytebell` key under the tool's top-level key, atomic-writes
  (tmp + rename, mode `0600`). A malformed existing file fails that one
  tool instead of being overwritten. Idempotent — keyed by the literal
  name `bytebell`, so re-running updates (e.g. a changed port) rather
  than duplicating.
- **[mcpTargets.ts](mcpTargets.ts)** — the `MCP_TARGETS` adapter table.
  One `McpTarget` per supported tool: `configPath()` (platform-branched
  — `~/Library/Application Support/…` on macOS, `~/.config/…` on Linux),
  `detect()` (config file / app dir present), `topLevelKey`
  (`mcpServers`, or `servers` for VS Code), and `entry(url)` (the
  per-tool entry shape — `{type,url}`, `{url}`, or `{serverUrl}`).
- **[McpToolSelector.tsx](McpToolSelector.tsx)** — Ink multi-select for
  `mcp install`. Mirrors `RepoSelector` multi-mode but defaults every
  detected tool to selected (the common case is "configure all"); `a`
  toggles all/none, Space toggles a row, Enter confirms, Esc cancels.
- **[Field.tsx](Field.tsx)** — single Ink row component used inside
  `SetupForm`. Renders an indicator + label + either an `ink-text-input`
  (when focused) or a static text view of the value (when not). Masking
  via `ink-text-input`'s `mask` prop on the password row; non-focused
  view shows `•••…` for masked rows. Renders an inline red error line
  underneath when the field's `validate` returns a non-null string.
- **[SetupForm.tsx](SetupForm.tsx)** — the Ink form rendered by
  `bytebell set` no-args **and** by `bytebell boot` when openrouter
  keys are missing on an interactive TTY. Nine rows declared in a
  `ROWS` constant: Mongo URI / Neo4j URI / Neo4j user / Neo4j password
  (masked) / Redis URL / Server port / GitHub Concurrency / OpenRouter
  API key (masked) / OpenRouter model. Each row carries its own
  format-only `validate` regex (or non-empty check for the openrouter
  rows). State: a single `useState<Record<string,string>>` keyed by
  row id and seeded from `loadInitial()` so users see and edit
  existing settings. Navigation via Ink's built-in `useFocusManager`
  (Tab / Shift-Tab). On Enter when all rows pass validation, iterates
  the dispatch table in row order calling `entry.setter(value)`. On
  Esc, exits without saving.

## Module dependency graph

```
output.ts          → (leaf — no imports)
keyMap.ts          → @bb/types (Config), @bb/config (LOG_LEVELS, setConfigValue, LogLevel)
Field.tsx          → ink, ink-text-input, react (type-only)
SetupForm.tsx      → ink, react, @bb/types (Config), @bb/config (getConfigValue),
                     keyMap.ts (KEY_MAP), Field.tsx (Field)
SetCommand.ts      → commander, react, ink (render), @bb/config (HINTS),
                     keyMap.ts (KEY_MAP, validKeysList), SetupForm.tsx (SetupForm),
                     output.ts (error, list, success)

bootConfig.ts      → node:crypto, @bb/types (Config), @bb/config (getConfigValue),
                     keyMap.ts (KEY_MAP)
dockerInfra.ts     → node:child_process, node:fs/promises, node:path, node:url
BootCommand.ts     → commander, react, ink (render), @bb/types (Config),
                     @bb/config (HINTS, getConfigValue), bootConfig.ts, dockerInfra.ts,
                     serverSpawn.ts, SetupForm.tsx (SetupForm), output.ts
ShutdownCommand.ts → commander, dockerInfra.ts (composeFilePath, down), output.ts,
                     shutdownPrompts.ts, serverLifecycle.ts (stopServer), infraMode.ts (isEmbedded)
serverLifecycle.ts → node:fs/promises, node:child_process (execFile), node:path,
                     @bb/config (getBytebellHome, getConfigValue), @bb/types (Config),
                     @bb/errors, serverSpawn.ts, output.ts

httpClient.ts      → node:url
serverSpawn.ts     → node:child_process, node:fs/promises, node:path, node:url,
                     @bb/types (Config), @bb/config (getBytebellHome, getConfigValue)

mcpTargets.ts      → node:path, node:fs (existsSync), node:os (homedir)
McpToolSelector.tsx → ink, react (type-only)
mcpInstall.ts      → node:path, node:fs, react, ink (render), @bb/types (Config),
                     @bb/config (getConfigValue), output.ts, mcpTargets.ts, McpToolSelector.tsx
McpCommand.ts      → commander, httpClient.ts, output.ts, mcpInstall.ts

ServerCommand.ts   → commander, node:child_process, node:path, node:url, output.ts
IndexCommand.ts    → commander, serverSpawn.ts, httpClient.ts, output.ts
IngestCommand.ts   → commander, node:fs/promises, node:path, serverSpawn.ts,
                     httpClient.ts, output.ts
LsCommand.ts       → commander, serverSpawn.ts, httpClient.ts, output.ts

version.ts         → (leaf — no imports)
ControlsBar.tsx    → ink, react (type-only)
MenuSelector.tsx   → ink, react (type-only), version.ts (VERSION), ControlsBar.tsx
ArgPrompt.tsx      → ink, react (type-only), Field.tsx (Field), ControlsBar.tsx
LlmConfigForm.tsx  → ink, react, @bb/types (Config), @bb/config (getConfigValue),
                     keyMap.ts (KEY_MAP), Field.tsx (Field), ControlsBar.tsx
MenuCommand.ts     → commander, react, ink (render), MenuSelector.tsx, LlmConfigForm.tsx,
                     ArgPrompt.tsx, program.ts (buildProgram), output.ts (info, success)
program.ts         → commander, every buildXCommand (incl. MenuCommand), version.ts
index.ts           → program.ts (buildProgram), MenuCommand.ts (runMenu), output.ts (error)
```

`program.ts` imports `MenuCommand.ts` (for `buildMenuCommand`) and
`MenuCommand.ts` imports `program.ts` (for `buildProgram`) — this cycle is
safe because both bindings are only invoked at runtime, never at module
load. `version.ts` is the leaf that keeps the version string out of the
cycle.

No cycles. `output.ts` is a leaf; `keyMap.ts` and `httpClient.ts` are
near-leaves. `serverSpawn.ts` and `dockerInfra.ts` both manage foreign
child processes and own no in-process state beyond a small per-call
context.

## Invariants enforced here

- **Shebang lives only in `index.ts`.** It is the binary entry; other
  files are imported.
- **Headless setter calls go through `KEY_MAP[key].setter`.** No file
  outside `keyMap.ts` calls `setConfigValue` directly. This keeps the
  type-narrowing closures the single source of truth and keeps password
  redaction (`entry.redact`) co-located with the setter.
- **Form runs format-only validation.** No network, no driver imports.
  Validators in `SetupForm.tsx`'s `ROWS` are pure regex / range checks.
- **Submit is atomic per call but not per form.** The form iterates
  six setters; each is its own atomic `setConfigValue` write. If one
  throws mid-loop, the form re-renders with the row's error highlighted
  and earlier fields stay written. Trade-off: rolling back partial
  writes would require a transaction abstraction in `@bb/config` that
  doesn't exist; the form's per-field format validation makes mid-loop
  failures essentially impossible in practice.
- **No raw `setConfigValue` casts.** Each `KEY_MAP` closure invokes
  `setConfigValue<Config.X>(Config.X, value)` so TypeScript checks the
  value type against `ConfigValueMap[Config.X]`. Adding a key without
  a closure (or with a wrong-type setter) is a compile error.
- **No env reads anywhere.** Repo-wide ESLint rule blocks `process.env`.
- **`bootConfig.applyInfraDefaults` only writes blank keys.** Re-running
  `bytebell boot` after a manual `bytebell set neo4j-password <new>`
  reads the user's value back via `getConfigValue` and uses it for
  the compose `.env`; it does **not** overwrite the user's choice.
- **`dockerInfra` resolves the compose file via `import.meta.url`.**
  No env vars, no cwd dependence — `bytebell boot` works from any
  directory and from `bun link`'d installs.
- **`ShutdownCommand` never escalates to `SIGKILL`.** If the server
  doesn't drain in 30 s the command exits 1 with a warning; the
  operator decides whether to force-kill. Matches the server's own
  shutdown timeout.

## Adding a Field

1. Add a row to `ROWS` in `SetupForm.tsx` — `{ id, label, cliKey, mask?, validate }`.
2. Confirm `KEY_MAP[cliKey]` exists in `keyMap.ts` (add it there if not).
3. Add the new key to the `loadInitial()` seed object so the field
   pre-populates from the existing config.
4. The form auto-renders the row in declaration order; no other
   wiring needed.
