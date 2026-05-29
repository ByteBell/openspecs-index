import { _runCypher } from "./client.ts";

/**
 * Snapshots the current `:File` set for a knowledge into `:FileVersion` nodes
 * tagged with `commitHash`. Run **before** the strategy overwrites the `:File`
 * nodes during a pull, so the prior commit's state is preserved as a version
 * snapshot rather than being lost.
 *
 * Each `:FileVersion` carries the same descriptive props as the `:File` it
 * came from (purpose, summary, businessContext, language, sha, sizeBytes) and
 * a `:VERSION_OF` edge back to the live `:File`. Symbol/keyword/import edges
 * are not duplicated — they live on the live `:File` and rotate on overwrite.
 *
 * Idempotent: the unique constraint on `(:FileVersion {knowledgeId, relativePath, commitHash})`
 * causes re-snapshotting the same commit to be a no-op.
 */
const SNAPSHOT_FILES_TO_VERSION = `
MATCH (f:File {knowledgeId: $knowledgeId})
MERGE (fv:FileVersion {
  knowledgeId: $knowledgeId,
  relativePath: f.relativePath,
  commitHash: $commitHash
})
SET fv.language = f.language,
    fv.sha = f.sha,
    fv.sizeBytes = f.sizeBytes,
    fv.purpose = f.purpose,
    fv.summary = f.summary,
    fv.businessContext = f.businessContext,
    fv.dataFlowDirection = f.dataFlowDirection,
    fv.ontologyConcepts = f.ontologyConcepts,
    fv.businessEntities = f.businessEntities,
    fv.systemCapabilities = f.systemCapabilities,
    fv.sideEffects = f.sideEffects,
    fv.configDependencies = f.configDependencies,
    fv.integrationSurface = f.integrationSurface,
    fv.contractsProvided = f.contractsProvided,
    fv.contractsConsumed = f.contractsConsumed,
    fv.sectionNames = f.sectionNames,
    fv.sectionDescriptions = f.sectionDescriptions,
    fv.sectionsJson = coalesce(f.sectionsJson, '[]'),
    fv.snapshotAt = $snapshotAt,
    // Legacy snake_case mirror props on the same :FileVersion node so the
    // chat-mcp reader (which filters on snake props) sees the same versions.
    fv.knowledge_id = $knowledgeId,
    fv.relative_path = f.relativePath,
    fv.commit_hash = $commitHash,
    fv.committed_at = $snapshotAt,
    fv.change_type = 'snapshot',
    fv.org_id = f.orgId,
    fv.section_map = coalesce(f.sectionsJson, '[]'),
    fv.business_context = f.businessContext,
    fv.data_flow_direction = f.dataFlowDirection,
    fv.ontology_concepts = f.ontologyConcepts,
    fv.business_entities = f.businessEntities,
    fv.system_capabilities = f.systemCapabilities,
    fv.side_effects = f.sideEffects,
    fv.config_dependencies = f.configDependencies,
    fv.integration_surface = f.integrationSurface,
    fv.contracts_provided = f.contractsProvided,
    fv.contracts_consumed = f.contractsConsumed
MERGE (f)-[:HAS_VERSION]->(fv)
WITH fv, f
OPTIONAL MATCH (fn:FileNode {knowledge_id: f.knowledgeId, relative_path: f.relativePath})
FOREACH (_ IN CASE WHEN fn IS NOT NULL THEN [1] ELSE [] END |
  MERGE (fn)-[:HAS_VERSION]->(fv)
)
WITH fv, f, fn
WHERE fn IS NOT NULL
OPTIONAL MATCH (kw:OrgKeyword)-[oe:APPEARS_IN_FILE]->(fn)
WITH fv, kw, oe
WHERE kw IS NOT NULL
MERGE (kw)-[ve:APPEARS_IN_FILE]->(fv)
SET ve.frequency = coalesce(oe.frequency, 1),
    ve.commit_hash = fv.commitHash,
    ve.org_id = oe.org_id,
    ve.updated_at = fv.snapshotAt
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
