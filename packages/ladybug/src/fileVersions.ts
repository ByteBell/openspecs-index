import { _runCypher } from "./client.ts";

/**
 * Snapshots the current `:File` set for a knowledge into `:FileVersion` nodes
 * tagged with `commitHash`. Run **before** the strategy overwrites the `:File`
 * nodes during a pull, so the prior commit's state is preserved as a version
 * snapshot rather than being lost.
 */
const SNAPSHOT_FILES_TO_VERSION = `
MATCH (f:File {knowledgeId: $knowledgeId})
CREATE (fv:FileVersion {
  id: $knowledgeId + "::" + f.relativePath + "::" + $commitHash,
  knowledgeId: $knowledgeId,
  relativePath: f.relativePath,
  commitHash: $commitHash,
  language: f.language,
  sha: f.sha,
  sizeBytes: f.sizeBytes,
  purpose: f.purpose,
  summary: f.summary,
  businessContext: f.businessContext,
  dataFlowDirection: f.dataFlowDirection,
  ontologyConcepts: f.ontologyConcepts,
  businessEntities: f.businessEntities,
  systemCapabilities: f.systemCapabilities,
  sideEffects: f.sideEffects,
  configDependencies: f.configDependencies,
  integrationSurface: f.integrationSurface,
  contractsProvided: f.contractsProvided,
  contractsConsumed: f.contractsConsumed,
  sectionNames: f.sectionNames,
  sectionDescriptions: f.sectionDescriptions,
  snapshotAt: $snapshotAt
})
CREATE (f)-[:HAS_VERSION]->(fv)
`;

export interface SnapshotFilesInput {
  knowledgeId: string;
  /** The commit the current `:File` state corresponds to — i.e. the OLD commitId being archived. */
  commitHash: string;
}

/** Copies every live `:File` into a `:FileVersion(commitHash)` snapshot. */
export async function snapshotFilesToVersion(input: SnapshotFilesInput): Promise<void> {
  await _runCypher(SNAPSHOT_FILES_TO_VERSION, {
    knowledgeId: input.knowledgeId,
    commitHash: input.commitHash,
    snapshotAt: new Date().toISOString(),
  });
}
