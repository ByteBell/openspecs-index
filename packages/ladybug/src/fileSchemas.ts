import { ParquetSchema } from "parquetjs";
import type { FileAnalysis } from "@bb/types";

export const fileParquetSchema = new ParquetSchema({
  id: { type: "UTF8" },
  orgId: { type: "UTF8" },
  knowledgeId: { type: "UTF8" },
  repoId: { type: "UTF8" },
  relativePath: { type: "UTF8" },
  language: { type: "UTF8" },
  sha: { type: "UTF8" },
  sizeBytes: { type: "INT64" },
  purpose: { type: "UTF8" },
  summary: { type: "UTF8" },
  businessContext: { type: "UTF8" },
  dataFlowDirection: { type: "UTF8" },
  ontologyConcepts: { type: "UTF8", repeated: true },
  businessEntities: { type: "UTF8", repeated: true },
  systemCapabilities: { type: "UTF8", repeated: true },
  sideEffects: { type: "UTF8", repeated: true },
  configDependencies: { type: "UTF8", repeated: true },
  integrationSurface: { type: "UTF8", repeated: true },
  contractsProvided: { type: "UTF8", repeated: true },
  contractsConsumed: { type: "UTF8", repeated: true },
  sectionNames: { type: "UTF8", repeated: true },
  sectionDescriptions: { type: "UTF8", repeated: true },
  isBigFile: { type: "BOOLEAN" },
  totalChunks: { type: "INT64" },
  totalTokenCount: { type: "INT64" },
  updatedAt: { type: "UTF8" },
});

export const relParquetSchema = new ParquetSchema({
  from: { type: "UTF8" },
  to: { type: "UTF8" },
});

export interface UpsertFileNodeInput {
  orgId?: string;
  knowledgeId: string;
  repoId?: string;
  relativePath: string;
  language: string;
  sha: string;
  sizeBytes: number;
  analysis: FileAnalysis;
  folderPath?: string;
  isBigFile?: boolean;
  totalChunks?: number;
  totalTokenCount?: number;
}
