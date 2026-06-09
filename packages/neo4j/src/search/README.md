# `@bb/neo4j/src/search`

Read-side graph queries for the Neo4j provider. Each file owns exactly
one of the five `IGraphSearchRepository` operations consumed by
`@bb/mcp`. Wired into the provider as a single namespace import:
`provider.ts` does `import * as searchRepo from "./search/index.ts"` and
hangs the functions off `Neo4jGraphProvider.search`.

## Tier

Infrastructure (sub-folder of `@bb/neo4j`).

## Files

- `index.ts` — barrel; re-exports the five public functions consumed by
  `provider.ts`. Has no logic of its own.
- `smartSearch.ts` — `runSmartSearchChannel(channel, input)`. Dispatches
  the seven smart-search channels (`purpose`, `businessContext`, `paths`,
  `keywords`, `classes`, `functions`, `importsInternal`,
  `importsExternal`) through the per-channel Neo4j cypher templates.
  Channels that target text payloads (`purpose`, `businessContext`,
  `keywords`, `classes`, `functions`) use the fulltext indexes built by
  `ensureKnowledgeIndexes` in the parent package; path / module-name
  channels use plain `STARTS WITH` / `CONTAINS`.
- `keywordLookup.ts` — `keywordLookup(input)`. Reverse-lookup over named
  entities: `Keyword`, `Module`, `Class`, `Function`. Caps results via
  `keywordLimit * filesPerKeyword`.
- `listKnowledge.ts` — `listKnowledgeBases()`. Returns one row per
  indexed repo with `fileCount`, ordered by `updatedAt DESC`. Fuels the
  MCP `list_knowledge` tool.
- `fileMetadata.ts` — `fetchFileMetadata(knowledgeId, paths)`. Bulk
  metadata read for `retrieve_file` metadata mode. Resolves files by
  composite id `${knowledgeId}::${relativePath}`; collects keywords,
  classes, functions, internal/external imports per file.
- `repoNames.ts` — `fetchRepoNames(knowledgeIds)`. `(knowledgeId,
repoName)` projection used to label retrieval results.
- `lucene.ts` — `escapeLucene(term)` and `buildFulltextQuery(terms)`.
  Escapes the Lucene reserved set (`+-&|!(){}[]^"~*?:\\/`) so user
  query terms can't break the fulltext parser, then wraps each term as
  `*term*` for substring matching. Used by `smartSearch.ts` for
  fulltext channels.

## Imports allowed

- Within this folder: siblings may import each other (`smartSearch.ts`
  consumes `lucene.ts`).
- Up into the parent package: `#src/client.ts` only (for `_runCypher`),
  never relative parent traversal.
- Cross-package: `@bb/graph-core` (types), `@bb/config`
  (`getKnowledgeScope` — read-scope seam).
- Forbidden: importing from `../knowledge.ts`, `../files.ts`, or any
  other write-side neo4j module — search is read-only.

## Invariants

- Every file is ≤ 300 lines (Rule of File Size).
- No writes. These functions only run `_runCypher` for MATCH/RETURN
  queries; they never call `CREATE`, `MERGE`, `SET`, or `DELETE`.
- Fulltext queries always go through `buildFulltextQuery` so user input
  is escaped against Lucene reserved characters.
- Return shapes match `IGraphSearchRepository` (defined in
  `@bb/graph-core`) so the provider's `search` namespace satisfies the
  interface without adapter layers.
- **Knowledge-scope honoured.** `smartSearch`, `keywordLookup`,
  `listKnowledge`, and `fileMetadata` read `getKnowledgeScope()` from
  `@bb/config` and add `AND ($scope IS NULL OR knowledgeId IN $scope)` to
  their MATCH filters. `$scope` is `null` by default (unrestricted); a host
  may register a resolver to restrict reads to an allowlist. An empty
  allowlist matches nothing.
