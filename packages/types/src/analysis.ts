export interface FileAnalysisSection {
  name: string;
  description: string;
  /** 1-indexed inclusive start line, when the LLM has provided it. */
  start_line?: number;
  /** 1-indexed inclusive end line, when the LLM has provided it. */
  end_line?: number;
}

export interface FileAnalysis {
  purpose: string;
  summary: string;
  businessContext: string;
  classes: string[];
  functions: string[];
  importsInternal: string[];
  importsExternal: string[];
  keywords: string[];
  ontologyConcepts?: string[];
  businessEntities?: string[];
  systemCapabilities?: string[];
  sideEffects?: string[];
  configDependencies?: string[];
  dataFlowDirection?: string;
  integrationSurface?: string[];
  contractsProvided?: string[];
  contractsConsumed?: string[];
  sectionMap?: FileAnalysisSection[];
}

export interface RawFileDoc {
  knowledgeId: string;
  relativePath: string;
  content: string;
  sha: string;
  sizeBytes: number;
  language: string;
  analysis: FileAnalysis;
  updatedAt: Date;
}
