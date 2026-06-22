# `@bb/sqlite`

SQLite implementation of the `IDocumentDatabaseProvider` interface.

## Responsibilities

Stores knowledge entries, raw file documents, activity logs, and usage records in a local SQLite database (via `bun:sqlite`). Registers itself as the `"sqlite"` provider with `@bb/db` at import time.

## Public Interfaces

- `connectSqlite()`, `closeSqlite()`, `pingSqlite()` — lifecycle and health probe
- Knowledge CRUD: `setKnowledgeState`, `setKnowledgeCommit`, `setKnowledgeBranch`, `updateKnowledgeProgress`, `upsertKnowledge`, `deleteKnowledge`, `listKnowledge`, `getKnowledge`, `markKnowledgeFailed`, `markKnowledgeHalted`, `markKnowledgeCorrupted`, `promoteHaltedToFailed`
- Raw files: `upsertRawFile`, `listRawFileShas`, `deleteRawFiles`
- Stats: `aggregateStats`
- Activity: `recordActivity`
- Usage: `incrementUsage`, `getMonthlyUsage`, `getGlobalUsage`

## Data Ownership

Owns a single SQLite file at the path configured by `Config.SqlitePath` (defaults to `~/.bytebell/data.sqlite`). Tables: `knowledge`, `raw_files`, `activity`, `usage`.

## Invariants

- Knowledge entries stored as JSON blobs keyed by `knowledgeId`
- Raw files keyed by `knowledgeId:relativePath` with a `knowledgeId` index
- WAL journal mode for concurrent read performance
- Foreign keys enforced

## Tier

Infrastructure (implements `@bb/db-core` interfaces, consumed via `@bb/db`)
