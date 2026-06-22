import type { ConceptKind, ContractKind, GuidepostKind } from "@bb/types";
import type {
  NodeScope,
  UpsertConceptInput,
  UpsertContractInput,
  UpsertGuidepostInput,
  ConceptEdgeKind,
  ContractEdgeKind,
} from "@bb/types";
import { conceptsGraph, contractsGraph, guidepostsGraph } from "@bb/graph-db";
import type { PerFileEnrichment } from "#src/concept-graph/enrichment-schema.ts";

export interface PersistEnrichmentInput {
  scope: NodeScope;
  relativePath: string;
  enrichmentRunId: string;
  parsed: PerFileEnrichment;
}

export async function persistEnrichment(input: PersistEnrichmentInput): Promise<void> {
  for (const c of input.parsed.concepts) {
    const upsertInput: UpsertConceptInput = {
      scope: input.scope,
      slug: c.slug,
      kind: c.kind as ConceptKind,
      name: c.name,
      rationale: c.rationale,
      enrichmentRunId: input.enrichmentRunId,
    };
    await conceptsGraph.upsertConcept(upsertInput);
    await conceptsGraph.attachFileToConcept({
      scope: input.scope,
      relativePath: input.relativePath,
      conceptSlug: c.slug,
      edgeKind: c.edge as ConceptEdgeKind,
      enrichmentRunId: input.enrichmentRunId,
    });
  }
  for (const ct of input.parsed.contracts) {
    const upsertInput: UpsertContractInput = {
      scope: input.scope,
      slug: ct.slug,
      kind: ct.kind as ContractKind,
      name: ct.name,
      enrichmentRunId: input.enrichmentRunId,
    };
    await contractsGraph.upsertContract(upsertInput);
    await contractsGraph.attachFileToContract({
      scope: input.scope,
      relativePath: input.relativePath,
      contractSlug: ct.slug,
      edgeKind: ct.edge as ContractEdgeKind,
      enrichmentRunId: input.enrichmentRunId,
    });
  }
  for (const g of input.parsed.guideposts) {
    const upsertInput: UpsertGuidepostInput = {
      scope: input.scope,
      slug: g.slug,
      kind: g.kind as GuidepostKind,
      note: g.note,
      area: g.area,
      enrichmentRunId: input.enrichmentRunId,
    };
    await guidepostsGraph.upsertGuidepost(upsertInput);
    await guidepostsGraph.attachGuidepost({
      scope: input.scope,
      guidepostSlug: g.slug,
      targetFileRelativePath: input.relativePath,
      enrichmentRunId: input.enrichmentRunId,
    });
  }
  if (input.parsed.testTarget !== undefined) {
    await conceptsGraph.upsertTestsEdge({
      scope: input.scope,
      testFileRelativePath: input.relativePath,
      targetFileRelativePath: input.parsed.testTarget.targetRelativePath,
      enrichmentRunId: input.enrichmentRunId,
    });
  }
}
