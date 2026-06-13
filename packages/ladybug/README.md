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
- Schema bootstrap — creating tables for `Knowledge`, `Repo`, `Folder`, `File`, `FileVersion`, `Keyword`, `Class`, `Function`, `Module`, `Concept`, `Contract`, and `Guidepost` (plus their rel tables).
- Knowledge-node CRUD (`upsertKnowledgeNode`, `setKnowledgeStateInGraph`, `deleteKnowledgeGraph`).
- Folder and Repository CRUD (`upsertFolderNode`, `upsertRepoNode`).
- Optimized File-node Bulk Upsert (`bulkUpsertFiles`) — maps files to Parquet rows, writes them to temporary files on disk, and executes single-transaction `DELETE` and SQL `COPY FROM` commands.
- File-node Snapshotting (`snapshotFilesToVersion`) — copies live files to snapshots before updates.
- Concept-graph writes (`upsertConcept`, `attachFileToConcept`, `upsertTestsEdge`, `upsertContract`, `attachFileToContract`, `upsertGuidepost`, `attachGuidepost`) — `:Concept` / `:Contract` / `:Guidepost` nodes plus their file edges, matching the neo4j provider's merge policy so the ConceptGraphStrategy persists identically on either backend.
- Read-side search (`src/search/`) — LadybugDB-native implementations of the `IGraphSearchRepository` surface: `runSmartSearchChannel` (fused per-channel scoring over `File` text, paths, keywords, classes/functions, and internal/external imports), `keywordLookup`, `listKnowledgeBases`, `fetchFileMetadata`, and `fetchRepoNames`. These back MCP smart_search / keyword_lookup / list_knowledge / retrieve_file(metadata) when the active graph provider is Ladybug. They are not named package exports — they are wired into the registered provider's `search` namespace in `src/provider.ts`.

## Public exports

```ts
function connectLadybug(): Promise<void>;
function closeLadybug(): Promise<void>;
function pingLadybug(): Promise<PingResult>;

function upsertKnowledgeNode(doc: KnowledgeDoc): Promise<void>;
function setKnowledgeStateInGraph(knowledgeId: string, state: KnowledgeState): Promise<void>;
function setKnowledgeBranchInGraph(knowledgeId: string, branch: string): Promise<void>;
function deleteKnowledgeGraph(knowledgeId: string): Promise<void>;
function vacuumOrphanEntities(): Promise<void>;
function upsertFileNode(input: UpsertFileNodeInput): Promise<void>;
function bulkUpsertFiles(knowledgeId: string, fileStream: AsyncIterable<UpsertFileNodeInput>): Promise<void>;
function deleteFileNodes(knowledgeId: string, paths: string[]): Promise<void>;

function upsertConcept(input: UpsertConceptInput): Promise<void>;
function attachFileToConcept(input: AttachFileToConceptInput): Promise<void>;
function upsertTestsEdge(input: UpsertTestsEdgeInput): Promise<void>;
function upsertContract(input: UpsertContractInput): Promise<void>;
function attachFileToContract(input: AttachFileToContractInput): Promise<void>;
function upsertGuidepost(input: UpsertGuidepostInput): Promise<void>;
function attachGuidepost(input: AttachGuidepostInput): Promise<void>;

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

Concept-graph layer (written by the ConceptGraphStrategy enrichment pass):

```
(:Concept {id, orgId, knowledgeId, slug, kind, name, rationale, enrichmentRunId, ...})
(:File)-[:HAS_CONCEPT | :PLAYS_ROLE | :BELONGS_TO_DOMAIN]-> (:Concept)
(:File)-[:TESTS]-> (:File)                              // test source → file under test

(:Contract {id, orgId, knowledgeId, slug, kind, name, enrichmentRunId, ...})
(:File)-[:DEFINES | :CONSUMES]-> (:Contract)

(:Guidepost {id, orgId, knowledgeId, slug, kind, note, area, enrichmentRunId, ...})
(:Guidepost)-[:ABOUT]-> (:File | :Concept | :Contract)  // polymorphic, exactly one target
```

Uniqueness and primary keys are enforced through computed surrogate IDs (e.g. `${knowledgeId}::${relativePath}` for files, `${orgId}::${knowledgeId}::${slug}` for concept-graph nodes) due to LadybugDB's single-column primary key constraints. Because LadybugDB requires every node and relationship table to be declared before a query references it, all of the labels above — including the concept-graph tables and their property-bearing rel tables (`enrichmentRunId` / `createdAt` / `updatedAt`) — are created up-front in `ensureSchema`.

Polymorphic relationships (such as `CONTAINS` and `HAS_KEYWORD`) are loaded with explicit query routing:

- `COPY CONTAINS FROM '...' (FROM='Folder', TO='File')`
- `COPY HAS_KEYWORD FROM '...' (FROM='File', TO='Keyword')`

## Invariants

1. **Memory-Safe Streaming Ingestion**: `bulkUpsertFiles` uses an `AsyncIterable` stream, writing inputs to temporary Parquet files on disk immediately to prevent heap allocation failures for large codebases.
2. **Graceful Connection**: Lazy initialization ensures connection runs once and caches the `Database` and `Connection` handles cleanly.
3. **Parameter Type Casting**: Explicit casts to `LbugValue` ensure type compatibility when executing parameter queries.
