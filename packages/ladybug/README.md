# `@bb/ladybug` — context

## Tier

Infrastructure. Depends on Kernel (`@bb/types` for `Config` and `KnowledgeState`, `@bb/errors` for typed error classes) and Sibling (`@bb/config` for `Config.LadybugPath`).
May be imported by Strategy (`@bb/queue` workers via `@bb/ingest-github`), Domain, and Binaries — never by `@bb/cli`.

This package implements the `@bb/graph-core` `IGraphDatabaseProvider` interface for **LadybugDB**, an embedded property graph OLAP database.

## Responsibility

The package owns:

- A single shared `@ladybugdb/core` `Database` and `Connection` instance (lazy connection; graceful close).
- A health probe (`pingLadybug`).
- An internal `_runCypher(query, params)` helper that compiles and runs a query, caching prepared statements globally.
- Schema bootstrap — creating tables for `Knowledge`, `Repo`, `Folder`, `File`, `FileVersion`, `Keyword`, `Class`, `Function`, and `Module`.
- Knowledge-node CRUD (`upsertKnowledgeNode`, `setKnowledgeStateInGraph`, `deleteKnowledgeGraph`).
- Folder and Repository CRUD (`upsertFolderNode`, `upsertRepoNode`).
- Optimized File-node Bulk Upsert (`bulkUpsertFiles`) — maps files to Parquet rows, writes them to temporary files on disk, and executes single-transaction `DELETE` and SQL `COPY FROM` commands.
- File-node Snapshotting (`snapshotFilesToVersion`) — copies live files to snapshots before updates.

## Public exports

```ts
function connectLadybug(): Promise<void>;
function closeLadybug(): Promise<void>;
function pingLadybug(): Promise<PingResult>;

function upsertKnowledgeNode(doc: KnowledgeDoc): Promise<void>;
function setKnowledgeStateInGraph(knowledgeId: string, state: KnowledgeState): Promise<void>;
function deleteKnowledgeGraph(knowledgeId: string): Promise<void>;
function upsertFileNode(input: UpsertFileNodeInput): Promise<void>;
function bulkUpsertFiles(knowledgeId: string, fileStream: AsyncIterable<UpsertFileNodeInput>): Promise<void>;
function deleteFileNodes(knowledgeId: string, paths: string[]): Promise<void>;

function runCypher<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T[]>;
```

## Graph schema (v1)

```
(:Knowledge {knowledgeId, sourceKind, sourceUrl, branch, repoName, state, createdAt, updatedAt})
  -[:HAS_FILE]->
(:File {id, orgId, knowledgeId, repoId, relativePath, language, sha, sizeBytes, purpose, summary, businessContext, ...})
  -[:HAS_KEYWORD]->  (:Keyword  {name})         // global, lowercase, MERGE-deduped
  -[:HAS_CLASS]->    (:Class    {signature})    // global, MERGE-deduped
  -[:HAS_FUNCTION]-> (:Function {signature})    // global, MERGE-deduped
  -[:HAS_IMPORT_INTERNAL]-> (:Module {name})    // relative imports (./ or ../)
  -[:HAS_IMPORT_EXTERNAL]-> (:Module {name})    // external packages / stdlib
```

Uniqueness and primary keys are enforced through computed surrogate IDs (e.g. `${knowledgeId}::${relativePath}`) due to LadybugDB's single-column primary key constraints.

Polymorphic relationships (such as `CONTAINS` and `HAS_KEYWORD`) are loaded with explicit query routing:

- `COPY CONTAINS FROM '...' (FROM='Folder', TO='File')`
- `COPY HAS_KEYWORD FROM '...' (FROM='File', TO='Keyword')`

## Invariants

1. **Memory-Safe Streaming Ingestion**: `bulkUpsertFiles` uses an `AsyncIterable` stream, writing inputs to temporary Parquet files on disk immediately to prevent heap allocation failures for large codebases.
2. **Graceful Connection**: Lazy initialization ensures connection runs once and caches the `Database` and `Connection` handles cleanly.
3. **Parameter Type Casting**: Explicit casts to `LbugValue` ensure type compatibility when executing parameter queries.
