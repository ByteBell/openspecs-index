import type { CondensedFileAnalysis } from "@bb/ingest-core";

export interface AnalyzedFileEntry {
  relativePath: string;
  language: string;
  analysis: CondensedFileAnalysis["analysis"];
  sha256: string;
  sizeBytes: number;
  tokenCount: number;
  isBigFile: boolean;
}

export interface FolderSummary {
  folderPath: string;
  purpose: string;
  summary: string;
  keywords: string[];
  classes: string[];
  functions: string[];
  importsInternal: string[];
  importsExternal: string[];
  dependencyGraph: string;
  generatedAt: string;
}

export interface RepoSummary {
  purpose: string;
  summary: string;
  keywords: string[];
  architecture: string;
  majorSubsystems: string[];
  dataFlow: string;
  keyPatterns: string[];
}

export interface RepoSummaryEnvelope {
  generatedAt: string;
  version: "v2-flat";
  source: "folder-summaries";
  knowledgeId: string;
  orgId: string;
  repoSummary: RepoSummary;
}

export interface FlatFolderResult {
  filesAnalyzed: number;
  foldersSummarised: number;
  repoSummarised: boolean;
  graphNodesWritten: number;
}
