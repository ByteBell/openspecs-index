# graph-storage — Neo4j writer for IR file-analysis

## Responsibility

Project IR file-analysis records (`IrFileAnalysisRecord`) into Neo4j as a richly
linked graph. One concern, one home: every node-and-edge derivation that the IR
strategy produces lands through this subpackage and nowhere else.

It is a pure writer. It does not read records from disk (the strategy's phases
do that and hand records in), and it does not perform any LLM calls or analysis.

## Public surface

Exported from `index.ts`:

- `ensureIrGraphSchema(): Promise<void>` — idempotent bootstrap. Creates the
  constraints and indexes for every label this writer touches. Run once per
  process before any `storeIr*` call.
- `storeIrFileAnalysis(ctx, record): Promise<void>` — small-file path. Creates
  one `:File` node plus every concept / structural / substrate / state edge
  derived from its `ModuleIr`, then the file's `:CodeUnit` children and any
  local call/data-flow edges between them.
- `storeIrChunkAnalysis(ctx, record, chunkIndex, totalChunks, startLine, endLine): Promise<void>`
  — big-file path. Upserts a header `:File` node (identity + flags, no semantic
  fields) on the first call, then a `:Chunk` per call hanging off it.
- `IrGraphStorageContext` — caller-supplied identity bag:
  `orgId, knowledgeId, repoId, commitHash, fileId`.

## Data ownership

This subpackage owns every node and edge below. Other writers (flat-folder,
mcp-enrichment) may set additional properties on the same `:File`/`:Knowledge`
nodes — but they are not the IR writer's concern and must be additive.

### Nodes

| Label | Key | Scope |
|---|---|---|
| `:Knowledge` | `knowledgeId` | shared with flat-folder |
| `:File` (multi-labelled `:IrFile`) | `(knowledgeId, relativePath)` | shared with flat-folder; IR-only properties prefixed where ambiguity matters |
| `:Chunk` | `(knowledgeId, relativePath, chunkIndex)` | IR-only |
| `:CodeUnit` | `(knowledgeId, unitId)` | IR-only |
| `:Keyword`, `:OntologyConcept`, `:BusinessEntity`, `:SystemCapability`, `:ConfigDependency`, `:IntegrationSurface`, `:UnresolvedCallee` | single content key | **global** — cross-repo shareable |
| `:Class`, `:Function`, `:ExportedSymbol`, `:ImportedModule`, `:Contract` | composite with `knowledgeId` | per-repo |
| `:PublicSignature`, `:TypeShape`, `:Section`, `:FileConstant`, `:ModuleLayoutEntry`, `:StateModel`, `:State` | composite with `(knowledgeId, fileId, …)` | per-file |
| `:VerbatimLiteral`, `:SideEffect`, `:EdgeCase`, `:BoundaryCondition`, `:ErrorHandlingItem`, `:Invariant`, `:DiagnosticNote`, `:Assumption`, `:Ambiguity` | content-hash key | **global** — identical content from many files shares one node |

### Edges

- Parent → concept: `:HAS_KEYWORD`, `:HAS_ONTOLOGY_CONCEPT`, `:MENTIONS_BUSINESS_ENTITY`,
  `:PROVIDES_CAPABILITY`, `:DEPENDS_ON_CONFIG`, `:EXPOSES_INTEGRATION`,
  `:DECLARES_CLASS`, `:DECLARES_FUNCTION`, `:EXPORTS`,
  `:IMPORTS_INTERNAL`, `:IMPORTS_EXTERNAL`,
  `:PROVIDES_CONTRACT`, `:CONSUMES_CONTRACT`
- Parent → structural: `:DECLARES_PUBLIC`, `:DECLARES_TYPE_SHAPE`, `:HAS_SECTION`,
  `:DECLARES_CONSTANT`, `:HAS_LAYOUT_ENTRY`
- Parent → substrate: `:CONTAINS_LITERAL`, `:HAS_SIDE_EFFECT`, `:HAS_EDGE_CASE`,
  `:HAS_BOUNDARY`, `:HANDLES_ERROR`, `:HAS_INVARIANT`, `:HAS_DIAGNOSTIC_NOTE`,
  `:HAS_ASSUMPTION`, `:HAS_AMBIGUITY`
- State model: `:HAS_STATE_MODEL` → `:HAS_STATE` → `:TRANSITIONS_TO`
- Containment: `:Knowledge -[:HAS_FILE]-> :File`, `:File -[:HAS_CHUNK]-> :Chunk`
- Units: `:File|:Chunk -[:HAS_UNIT]-> :CodeUnit`, `:CodeUnit -[:CHILD_OF]-> :CodeUnit`
- Call/flow: `:CodeUnit -[:CALLS|:FLOWS_TO]-> :CodeUnit | :UnresolvedCallee`

## Invariants

1. **Idempotent.** Every write is MERGE-shaped; re-running the same record on
   the same commit leaves the graph in the same state.
2. **Additive over flat-folder.** When a `:File` already exists from the
   flat-folder writer, this writer adds the `:IrFile` label + IR properties +
   IR edges. It never deletes a flat-folder property or edge.
3. **Concept nodes are never deleted.** A re-analysis of file X clears X's
   outgoing IR edges and re-attaches them. The concept nodes (`:Keyword`,
   `:Class`, `:Invariant`, …) live independently — other files may point at
   them.
4. **Substrate sharing.** Substrate nodes (`:Invariant`, `:EdgeCase`, …) are
   keyed by `sha1(normalised content)`. Two files asserting the same invariant
   point at the same node — "find every file with this invariant" is one hop.
5. **No transaction wrapping.** `@bb/neo4j` exposes only `runCypher`; each
   MERGE step is independently idempotent so partial failure leaves the graph
   in a consistent (just stale) state.

## External dependencies

- `@bb/neo4j` — only the `runCypher` export.
- Sibling intra-package imports use `#src/...` per the workspace rules.

## Tier

Domain (sits next to the rest of the IR strategy under `@bb/ingest-github`).

## What lives elsewhere

- The deep `CodeUnit` IR (signature, parameters, logicOutline, verbatimBlocks,
  …) from the reconstruction phase is **not** projected here yet. A follow-up
  writer will SET those properties additively on the same `:CodeUnit` node.
- `McpEnrichmentRecord` writes (resolved import paths, contract resolutions,
  ambiguity resolutions) are also a follow-up — they will update edge
  properties already present (`resolvedRelativePath`, `resolvedFileId`,
  `resolution`) without creating new nodes.
