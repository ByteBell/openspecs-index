import type { PerFileEnrichment } from "#src/concept-graph/enrichment-schema.ts";

export interface KnownEntity {
  slug: string;
  kind: string;
  name: string;
}

export class EnrichmentRegistry {
  readonly concepts = new Map<string, KnownEntity>();
  readonly contracts = new Map<string, KnownEntity>();

  recordConcepts(entries: PerFileEnrichment["concepts"]): void {
    for (const c of entries) {
      if (!this.concepts.has(c.slug)) {
        this.concepts.set(c.slug, { slug: c.slug, kind: c.kind, name: c.name });
      }
    }
  }

  recordContracts(entries: PerFileEnrichment["contracts"]): void {
    for (const c of entries) {
      if (!this.contracts.has(c.slug)) {
        this.contracts.set(c.slug, { slug: c.slug, kind: c.kind, name: c.name });
      }
    }
  }

  knownConcepts(): KnownEntity[] {
    return Array.from(this.concepts.values());
  }

  knownContracts(): KnownEntity[] {
    return Array.from(this.contracts.values());
  }
}
