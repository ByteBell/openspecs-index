import { readFile } from "node:fs/promises";
import path from "node:path";
import { metaRootFor, orgRegistryDir } from "@bb/ingest-core";
import { logger } from "@bb/logger";

const TOP_N = 50;

/**
 * Org-level keyword registry files the reader probes for. None of these are
 * produced by OSS today; downstream multi-tenant deployments may produce them
 * by aggregating across all knowledges in an org. Missing files are normal
 * and degrade silently to empty data.
 */
type OrgRegistryFile =
  | "keywords.json"
  | "business-entities.json"
  | "ontology-concepts.json"
  | "system-capabilities.json"
  | "integration-surface.json"
  | "contracts-provided.json"
  | "contracts-consumed.json"
  | "side-effects.json"
  | "config-dependencies.json";

export interface KeywordCount {
  keyword: string;
  count: number;
}

export interface EnrichmentData {
  topKeywords: KeywordCount[];
  topBusinessEntities: KeywordCount[];
  topOntologyConcepts: KeywordCount[];
  topSystemCapabilities: KeywordCount[];
  integrationSurface: KeywordCount[];
  contractsProvided: KeywordCount[];
  contractsConsumed: KeywordCount[];
  sideEffects: KeywordCount[];
  configDependencies: KeywordCount[];
  repoArchitecture: string;
  repoDataFlow: string;
  repoKeyPatterns: string[];
  majorSubsystems: Array<{ name: string; responsibility: string }>;
}

export function emptyEnrichment(): EnrichmentData {
  return {
    topKeywords: [],
    topBusinessEntities: [],
    topOntologyConcepts: [],
    topSystemCapabilities: [],
    integrationSurface: [],
    contractsProvided: [],
    contractsConsumed: [],
    sideEffects: [],
    configDependencies: [],
    repoArchitecture: "",
    repoDataFlow: "",
    repoKeyPatterns: [],
    majorSubsystems: [],
  };
}

async function readJsonSafe(filePath: string): Promise<unknown | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

async function readOrgRegistry(dir: string, file: OrgRegistryFile): Promise<KeywordCount[]> {
  const data = await readJsonSafe(path.join(dir, file));
  if (data === null || typeof data !== "object") {
    return [];
  }
  const entries: KeywordCount[] = [];
  for (const [keyword, count] of Object.entries(data as Record<string, unknown>)) {
    if (typeof count === "number") {
      entries.push({ keyword, count });
    }
  }
  entries.sort((a, b) => b.count - a.count);
  return entries.slice(0, TOP_N);
}

interface RepoSummaryShape {
  architecture?: string;
  dataFlow?: string;
  keyPatterns?: unknown;
  majorSubsystems?: unknown;
}

async function readRepoSummary(knowledgeId: string, enrichment: EnrichmentData): Promise<void> {
  const repoSummaryJson = path.join(await metaRootFor(knowledgeId), "repo-summary.json");
  const data = await readJsonSafe(repoSummaryJson);
  if (data === null || typeof data !== "object") {
    return;
  }
  const rs = ((data as { repoSummary?: RepoSummaryShape }).repoSummary ?? data) as RepoSummaryShape;
  if (typeof rs.architecture === "string") {
    enrichment.repoArchitecture = rs.architecture;
  }
  if (typeof rs.dataFlow === "string") {
    enrichment.repoDataFlow = rs.dataFlow;
  }
  if (Array.isArray(rs.keyPatterns)) {
    enrichment.repoKeyPatterns = rs.keyPatterns.filter((p): p is string => typeof p === "string");
  }
  if (Array.isArray(rs.majorSubsystems)) {
    enrichment.majorSubsystems = rs.majorSubsystems
      .filter((s): s is { name?: unknown; responsibility?: unknown } => typeof s === "object" && s !== null)
      .map((s) => ({
        name: typeof s.name === "string" ? s.name : "",
        responsibility: typeof s.responsibility === "string" ? s.responsibility : "",
      }))
      .filter((s) => s.name.length > 0);
  }
}

/**
 * Reads enrichment data from disk. Never throws — every missing file degrades
 * silently to empty data. The strategy proceeds with whatever it finds; the
 * LLM is robust to empty enrichment sections.
 */
export async function collectEnrichmentData(knowledgeId: string, orgId: string): Promise<EnrichmentData> {
  const enrichment = emptyEnrichment();
  const registryDir = await orgRegistryDir(knowledgeId, orgId);

  enrichment.topKeywords = await readOrgRegistry(registryDir, "keywords.json");
  enrichment.topBusinessEntities = await readOrgRegistry(registryDir, "business-entities.json");
  enrichment.topOntologyConcepts = await readOrgRegistry(registryDir, "ontology-concepts.json");
  enrichment.topSystemCapabilities = await readOrgRegistry(registryDir, "system-capabilities.json");
  enrichment.integrationSurface = await readOrgRegistry(registryDir, "integration-surface.json");
  enrichment.contractsProvided = await readOrgRegistry(registryDir, "contracts-provided.json");
  enrichment.contractsConsumed = await readOrgRegistry(registryDir, "contracts-consumed.json");
  enrichment.sideEffects = await readOrgRegistry(registryDir, "side-effects.json");
  enrichment.configDependencies = await readOrgRegistry(registryDir, "config-dependencies.json");

  await readRepoSummary(knowledgeId, enrichment);

  logger.info(
    `business-context: enrichment loaded — ${enrichment.topKeywords.length} kw, ${enrichment.topBusinessEntities.length} entities, architecture=${enrichment.repoArchitecture.length > 0}, subsystems=${enrichment.majorSubsystems.length}`,
  );
  return enrichment;
}
