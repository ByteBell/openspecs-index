# `@bb/mongo` — context

## Tier

Infrastructure. Depends on Kernel (`@bb/types` for `Config` and
`KnowledgeState`, `@bb/errors` for typed error classes) and on infra
siblings explicitly listed in `package.json` (`@bb/config` for
`Config.MongoUri`). May be imported by Strategy (`@bb/queue`), Domain,
and Binaries — never by `@bb/cli` (CLI talks HTTP only).

## Responsibility

The package owns:

- A single shared `MongoClient` (lazy, idempotent connect; graceful close)
- A health probe (`pingMongo`) backed by the active connection
- An internal `_getDb()` accessor that typed collection helpers in this
  package compose against
- Domain CRUD helpers:
  - `setKnowledgeState` — the knowledge-document state mutator. Called
    by `@bb/queue` publishers on enqueue.
  - Failure lifecycle (`knowledge-failure.ts`): `markKnowledgeFailed`
    (terminal), `markKnowledgeHalted` (transient, auto-retry pending),
    `markKnowledgeCorrupted` (terminal `CORRUPTED` — source repo
    gone/inaccessible, dropped from the auto-pull sweep), and
    `promoteHaltedToFailed`. All stamp the structured `failure` subdoc.
  - `upsertKnowledge` / `listKnowledge` — knowledge-doc upsert and list
    (with file count joined from `raw`). Used by the github / local
    index routes and by `@bb/cli`'s `ls` and `delete` flows.
  - `deleteKnowledge` — hard delete: removes the `knowledge` doc and
    every `raw` row tagged with that `knowledgeId`. Called by the
    server's `DELETE /api/v1/repos/:knowledgeId` route.
  - `upsertRawFile` — per-file Raw doc writer (compound key
    `{ knowledgeId, relativePath }`). Called by `@bb/ingest-github`'s
    worker for every scanned file.
  - `setKnowledgeCommit(knowledgeId, commitHash, inputTokens, outputTokens, costUsd)`
    — appends `{ hash, inputTokens, outputTokens, costUsd }` to
    `source.commitHashes[]` and sets `source.commitId`. `costUsd` is the
    OpenRouter-reported USD cost (`response.usage.cost`) summed across
    the pipeline phases for this commit — never computed client-side.
  - `aggregateStats` — read every `knowledge` doc and assemble the
    kube-shaped `StatsResponse` (totals, repos, commitStats) by summing
    `source.commitHashes[].{inputTokens,outputTokens,costUsd}`. Called by
    the server's `GET /api/v1/stats` route. The deprecated
    `processing_stats` collection is no longer queried.
- A central registry of collection name strings (`Collections` enum):
  `knowledge`, `raw`, `mcp_usage`, `mcp_activity`. The
  `processing_stats` collection has been removed — per-commit token +
  cost data lives on the knowledge document's `source.commitHashes[]`
  instead.
- Enrichment ledger for ConceptGraphStrategy (`enrichment.ts`):
  `startEnrichmentRun(knowledgeId, runId)`,
  `markFileEnriched(knowledgeId, path)`,
  `recordEnrichmentFailure(knowledgeId, failure)`,
  `completeEnrichmentRun(knowledgeId)`,
  `failEnrichmentRun(knowledgeId)`. State lives on the existing
  `KnowledgeDoc` (`enrichmentRunId`, `enrichmentState`,
  `completedFiles[]`, `enrichmentFailures[]`) — no new collection.
  `KnowledgeDoc.status.state` itself stays `PROCESSING` until enrichment
  reports `Completed`; this ledger tracks the per-file resume state so
  retries skip already-enriched files.

The package does **not** own:

- Knowledge-document creation, full reads, or any mutation other than the
  state field (deferred — see _How to extend_)
- Document schemas (live in `@bb/types`)
- Index management (deferred)
- Neo4j / graph queries (`@bb/graph`)
- Telemetry, logging, retry policies (the driver handles transport retries)

## Public exports

```ts
function connectMongo(): Promise<void>;
function closeMongo(): Promise<void>;
function pingMongo(): Promise<PingResult>;
function getMongoDb(): Db; // connected Db handle for consumers that own their own collection

function setKnowledgeState(knowledgeId: string, state: KnowledgeState): Promise<void>;
function upsertRawFile(doc: Omit<RawFileDoc, "updatedAt">): Promise<void>;

interface PingResult {
  ok: boolean;
  latencyMs: number;
}
interface FileAnalysis {
  purpose: string;
  summary: string;
  businessContext: string;
  classes: string[];
  functions: string[];
  importsInternal: string[];
  importsExternal: string[];
  keywords: string[];
}
interface RawFileDoc {
  knowledgeId: string;
  relativePath: string;
  content: string;
  sha: string;
  sizeBytes: number;
  language: string;
  analysis: FileAnalysis;
  updatedAt: Date;
}
```

(`MongoConfigError`, `MongoConnectError`, `MongoNotConnectedError`,
`KnowledgeNotFoundError` are thrown by these functions but **defined in
`@bb/errors`** — import them from there.)

`RawFileDoc` and `FileAnalysis` are package-local for now; they'll
graduate to `@bb/types` when a second consumer (e.g. `@bb/mcp` retrieval)
needs to read Raw docs.

The `Collections` enum is **internal** — consumed only by helpers inside this
package. The preferred way to touch Mongo is still a typed domain helper exported
from here. `getMongoDb()` is the one sanctioned escape hatch: a public wrapper
over the internal `_getDb()` for a consumer that owns a collection whose shape
does **not** belong in this infra package (e.g. `@bb/ingest-core`'s `ignored_files`
audit collection). Such consumers own their own document shape + write logic and
only borrow the connection.

## Data ownership

The single shared `MongoClient` instance. Document shapes, indexes, and
migrations are intentionally not owned here.

## Invariants

1. **No env reads.** The Mongo URI comes from
   `getConfigValue(Config.MongoUri)`. No `process.env`, no `.env`, no fallback.
   Enforced repo-wide by [eslint.config.mjs:71-94](../../eslint.config.mjs#L71-L94).
2. **`connectMongo()` is idempotent and concurrent-safe.** Repeated calls
   return the existing client; concurrent calls await the same in-flight
   connect promise.
3. **`closeMongo()` is graceful.** Clears the cached client before awaiting
   `client.close()` so a subsequent `connectMongo()` cleanly re-establishes.
4. **Errors are typed, not strings.** `MongoConfigError` carries the exact
   `bytebell set …` hint; `MongoConnectError` redacts credentials in the URI.
5. **Db access is deliberate.** `_getDb()` stays internal; the only public
   raw-handle accessor is `getMongoDb()`, added for consumers that own their own
   collection shape (they borrow the connection, not the schema). Everything with
   a shape this package owns is still reached through a typed helper.

## External dependencies

- `mongodb` — official driver
- `@bb/config` — workspace dep, for `getConfigValue(Config.MongoUri)`
- `@bb/types` — workspace dep, for `Config` and `KnowledgeState`
- `@bb/errors` — workspace dep, for the typed error classes thrown here

No logger, no telemetry, no Neo4j, no Redis. This package boots after
`@bb/config` and before everything that needs persistence.

## What is intentionally out of scope (v0)

- Knowledge-document creation, deletion, or full reads
  (`getKnowledgeById`, `createKnowledge`, etc.) — added when the first
  caller arrives
- Raw deletion / `deleteRawFile(knowledgeId, relativePath)` —
  added when `github_pull` lands and needs to clean up files removed in
  a diff
- `Nodes` and `Jobs` collection helpers — deferred until callers need
  them
- Index creation / migrations
- Transactions helper
- Change streams, GridFS
- Application-level retry / backoff (the driver handles transport retries)
- A standalone "probe a candidate URI" helper for the setup form (added when
  `@bb/cli`'s setup form lands)

## How to extend

Adding a new CRUD helper (e.g. `getKnowledgeById`):

1. Pick or create the appropriate `Collections` enum entry in
   `src/collections.ts` (single source of truth for collection names).
2. Create `src/<name>.ts` (flat — repo ESLint forbids parent traversal,
   so subdirectories require import gymnastics; keep `src/` flat).
3. Use `_getDb()` to obtain the `Db` handle and access the named
   collection — never expose the raw `Db` to callers.
4. Return / accept domain types from `@bb/types`. Throw typed errors
   from `@bb/errors`.
5. Re-export the helper from `src/index.ts`.
6. Update the _Public exports_ and _Out of scope_ sections of this file.
