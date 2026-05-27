# `@bb/ladybug/src` — context

Implementation of `@bb/ladybug`. See [../README.md](../README.md) for the package-level contract; this file documents the code structure of the source directory.

## Files

- **[index.ts](index.ts)** — Public entrypoint. Re-exports driver controls, entity repositories, and helper types.
- **[client.ts](client.ts)** — Connection lifecycle (`connectLadybug`, `closeLadybug`), schema initialization, global Prepared Statement caching, and parameter query execution.
- **[provider.ts](provider.ts)** — Registers the `"ladybug"` provider and packages the repositories to conform to the `IGraphDatabaseProvider` contract.
- **[files.ts](files.ts)** — Handles files. Implements `bulkUpsertFiles` utilizing `parquetjs` writers and SQL `COPY FROM` commands, writing incoming streams directly to disk.
- **[fileVersions.ts](fileVersions.ts)** — Snapshots file records into the `FileVersion` table before updates.
- **[folder.ts](folder.ts)** — Manages folder node upserting.
- **[repo.ts](repo.ts)** — Manages repository node upserting.
- **[knowledge.ts](knowledge.ts)** — Manages knowledge metadata, branch state, and asynchronous sweeping of orphan entity nodes (`vacuumOrphanEntities`).
- **[indexes.ts](indexes.ts)** & **[flatFolderIndexes.ts](flatFolderIndexes.ts)** — No-op files satisfying interface constraints (indexing is natively optimized in LadybugDB).

## Invariants

- **PreparedStatement Caching**: All query strings run via `_runCypher` check a global map for a cached `PreparedStatement` instance, avoiding redundant compiling overhead during loops.
- **Surrogate Keys**: Primary keys are computed strictly in TypeScript (e.g. `${knowledgeId}::${relativePath}`) before inserts.
- **Clean Slate**: `bulkUpsertFiles` executes a targeted clean slate delete of `File` nodes matching the `knowledgeId` before loading the new files, keeping transactions atomic.
- **Polymorphic Copy Mapping**: Restricts database-side ambiguity by passing explicit parameter routing:
  - `(FROM='Folder', TO='File')` for `CONTAINS`
  - `(FROM='File', TO='Keyword')` for `HAS_KEYWORD`
