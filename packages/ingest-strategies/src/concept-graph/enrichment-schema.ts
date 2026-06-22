import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema for the LLM's structured per-file enrichment output. Validated
// strictly before any graph write — invalid output → file marked failed →
// no nodes touched. Mirror this schema in the prompt so the model knows the
// exact shape expected.
//
// Slug constraints:
//   • kebab-case (lower-alphanumeric + hyphen)
//   • 1–64 chars
//   • used as the canonical key inside Neo4j (orgId, knowledgeId, slug)
// Two files emitting the same slug intentionally converge on the same node —
// that is how cross-file canonicalisation works.
// ─────────────────────────────────────────────────────────────────────────────

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

const slugSchema = z.string().regex(SLUG_REGEX, "slug must be kebab-case alphanumeric (1–64 chars)");

const CONCEPT_KINDS = ["ontology", "business", "capability", "role", "pattern", "domain"] as const;
const CONTRACT_KINDS = ["interface", "schema", "event", "config"] as const;
const GUIDEPOST_KINDS = ["anomaly", "convention", "history", "warning", "starting-point"] as const;
const CONCEPT_EDGE_KINDS = ["HAS_CONCEPT", "PLAYS_ROLE", "BELONGS_TO_DOMAIN"] as const;
const CONTRACT_EDGE_KINDS = ["DEFINES", "CONSUMES"] as const;

export const conceptAttachmentSchema = z.object({
  slug: slugSchema,
  kind: z.enum(CONCEPT_KINDS),
  name: z.string().min(1).max(120),
  rationale: z.string().min(1).max(500),
  edge: z.enum(CONCEPT_EDGE_KINDS),
});

export const contractAttachmentSchema = z.object({
  slug: slugSchema,
  kind: z.enum(CONTRACT_KINDS),
  name: z.string().min(1).max(120),
  edge: z.enum(CONTRACT_EDGE_KINDS),
});

export const guidepostSchema = z.object({
  slug: slugSchema,
  kind: z.enum(GUIDEPOST_KINDS),
  note: z.string().min(1).max(800),
  area: z.string().min(1).max(120),
});

/** Test relationship for a single file — points at the file under test. */
export const testTargetSchema = z.object({
  targetRelativePath: z.string().min(1),
});

/**
 * Tolerant wrapper around `testTargetSchema`. LLMs routinely emit
 * `testTarget: null` (and sometimes `""` or `{}`) for non-test files
 * instead of omitting the key as the prompt asks. Preprocess to treat
 * any null / empty-string / empty-object value as absent. Real test
 * targets (objects with `targetRelativePath`) still go through strict
 * validation.
 */
const tolerantTestTargetSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.length === 0) {
    return undefined;
  }
  if (typeof value === "object" && Object.keys(value as object).length === 0) {
    return undefined;
  }
  return value;
}, testTargetSchema.optional());

export const perFileEnrichmentSchema = z.object({
  concepts: z.array(conceptAttachmentSchema).max(20).default([]),
  contracts: z.array(contractAttachmentSchema).max(20).default([]),
  guideposts: z.array(guidepostSchema).max(10).default([]),
  testTarget: tolerantTestTargetSchema,
});

export type PerFileEnrichment = z.infer<typeof perFileEnrichmentSchema>;
export type ConceptAttachment = z.infer<typeof conceptAttachmentSchema>;
export type ContractAttachment = z.infer<typeof contractAttachmentSchema>;
export type GuidepostInput = z.infer<typeof guidepostSchema>;
export type TestTargetInput = z.infer<typeof testTargetSchema>;

/**
 * JSON Schema representation of `perFileEnrichmentSchema` for inclusion in
 * the LLM system prompt. Kept hand-rolled (rather than via `zod-to-json-schema`)
 * to avoid pulling another dep — the surface is small enough to write by
 * hand and keep in lockstep with the Zod schema above.
 */
export const PER_FILE_ENRICHMENT_JSON_SCHEMA_HINT = `{
  "concepts": [
    {
      "slug": "kebab-case-id",
      "kind": "${CONCEPT_KINDS.join(" | ")}",
      "name": "Human-readable name",
      "rationale": "Short justification anchored in this file's behaviour",
      "edge": "${CONCEPT_EDGE_KINDS.join(" | ")}"
    }
  ],
  "contracts": [
    {
      "slug": "kebab-case-id",
      "kind": "${CONTRACT_KINDS.join(" | ")}",
      "name": "Human-readable name",
      "edge": "${CONTRACT_EDGE_KINDS.join(" | ")}"
    }
  ],
  "guideposts": [
    {
      "slug": "kebab-case-id",
      "kind": "${GUIDEPOST_KINDS.join(" | ")}",
      "note": "Observation in your own words",
      "area": "Free-text scope, e.g. 'auth' or 'ingestion pipeline'"
    }
  ],
  "testTarget": { "targetRelativePath": "src/foo.ts" } // OPTIONAL — set only when this file is a test file
}`;
