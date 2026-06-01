export interface MetaPaths {
  metaRoot: string;
  fileAnalysisDir: string;
  folderSummariesDir: string;
  bigFileAnalysisDir: string;
  bigFileChunksDir: string;
  /**
   * Sibling directory to `fileAnalysisDir` / `bigFileChunksDir`, written by the `phase2-mcp`
   * strategy. Small-file enrichments live at `mcpEnrichmentDir/<encoded>.json`; big-file
   * chunk enrichments at `mcpEnrichmentDir/<encoded>/chunk-N.json`. Pass-1 records on disk
   * are never mutated — these records are a parallel surface keyed by the same encoded path.
   */
  mcpEnrichmentDir: string;
  /**
   * Per-unit IR records written by the intermediate-representation strategy's unit-analysis
   * phases. Small-file units live at `unitAnalysisDir/<encoded>/<safeUnit>.{source,analysis}.json`;
   * big-file chunk units at `unitAnalysisDir/<encoded>/chunk-<N>/<safeUnit>.{source,analysis}.json`.
   * Parallel surface to `fileAnalysisDir` / `bigFileChunksDir` — pass-1 records are never mutated.
   */
  unitAnalysisDir: string;
  bigFilesJson: string;
  scanManifestJson: string;
  repoSummaryJson: string;
}
