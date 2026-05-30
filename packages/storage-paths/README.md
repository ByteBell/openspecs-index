# @bb/storage-paths

**Tier:** infrastructure. The single source of truth for every on-disk storage path in the ingestion engine. Nothing else may `path.join` against a storage root; if a new artifact needs a home, add its builder here.

## Responsibilities

- Resolve the org-scoped, per-commit directory tree where all ingestion artifacts live.
- Own the `orgs/<orgId>` scoping explicitly (NOT the home resolver), so an org's data is never split across roots.
- Provide pure path builders + a `MetaStorageLayout` so consumers never re-derive `path.join(dir, encode(rel))`.

## Layout

```
<base>/                                   storageBase()  (= getBytebellHome(): ~/.bytebell in OSS, $KNOWLEDGE_BASE_PATH in enterprise)
└── orgs/<orgId>/                         orgRoot(orgId)
    ├── <provider>/<owner>/<repo>/<knowledgeId>/<commitHash>/   repoCommitRoot(id)
    │   ├── repo/                         repoCommitCloneDir(id)   — the git checkout @ this commit
    │   ├── file-analysis/<enc>.json      fileAnalysisFile
    │   ├── folder-summaries/<enc|__ROOT__>.json   folderSummaryFile
    │   ├── big-file-analysis/<enc>.manifest.json  bigFileManifest
    │   │   └── chunks/<enc>/chunk-N.json bigFileChunk
    │   ├── code-units/<enc>.json         codeUnitsFile   — IR-extracted code units
    │   ├── bigFiles.json · scan-manifest.json · repo-summary.json
    │   └── business-context/<title>/{original.txt,analysis.json}   businessContextDir(id, title)
    ├── llm-cache/<shard>/<key>.json      llmCacheRoot(orgId) + llmCacheEntryUnder
    └── keyword-registry/                 orgRegistryDir(orgId)
```

`<base>` is the RAW home; this package appends `orgs/<orgId>` exactly once. In the enterprise server the OSS home resolver returns `$KNOWLEDGE_BASE_PATH` (raw), so paths become `$KNOWLEDGE_BASE_PATH/orgs/<orgId>/…` with no duplicate `orgs`.

## Public interfaces

- Identity: `RepoCommitIdentity { orgId, provider, owner, repo, knowledgeId, commitHash }`.
- Roots: `storageBase`, `orgRoot`, `repoCommitRoot`, `repoCommitCloneDir`, `businessContextDir`, `orgRegistryDir`, `llmCacheRoot`, `llmCacheEntryUnder`, `ensure*`.
- Meta: `repoCommitMetaPathsFor(id)`, `ensureMetaDirs`, `MetaPaths`.
- Builders: `fileAnalysisFile`, `bigFileChunkDir`, `bigFileChunk`, `bigFileManifest`, `folderSummaryFile`, `codeUnitsFile`, `encodeMetaPath`, `decodeMetaPath`.
- Layout: `createRepoCommitStorageLayout(id) → MetaStorageLayout`.

## Invariants

- Addressing is always by full `RepoCommitIdentity` — knowledgeId alone is never enough, because the same knowledge has distinct per-commit trees. Readers (MCP retrieval, pull) resolve the commit from the knowledge record before building a path.
- Different commits of the same repo never share a directory.

## External dependencies

- `@bb/config` — `getBytebellHome()` for the raw base only.
