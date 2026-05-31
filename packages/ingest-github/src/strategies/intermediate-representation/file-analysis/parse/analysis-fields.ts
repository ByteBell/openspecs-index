/**
 * Narrows the file-level analysis fields of a file-analysis response into a total
 * {@link SemanticFields}. Layered:
 *
 * 1. v1 carryovers (purpose, summary, businessContext, keywords, ontologyConcepts,
 *    businessEntities, systemCapabilities, configDependencies, classes, functions) reuse
 *    flat-folder's `shapeAnalysis` shaper so v1 narrowing stays single-sourced.
 * 2. Reshaped fields (imports*, contracts*, sectionMap, sideEffects, integrationSurface) and
 *    every new v2 field are narrowed locally from the same raw input by the parsers in
 *    `./v2/`.
 *
 * The dropped v1 field `dataFlowDirection` is intentionally absent.
 */
import { shapeAnalysis } from "#src/adapters/llm-file-analyzer.ts";
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type { SemanticFields } from "#src/strategies/intermediate-representation/file-analysis/types/semantics.ts";
import { parseInternalImports, parseExternalImports } from "./v2/imports.ts";
import { parseContracts } from "./v2/contracts.ts";
import { parseSectionMap } from "./v2/section-map.ts";
import { parseSideEffects } from "./v2/side-effects.ts";
import { parsePublicSignatures, parseTypeShapes } from "./v2/signatures.ts";
import { parseLocalCallGraph, parseDataFlowGraph } from "./v2/graphs.ts";
import { parseVerbatimLiterals } from "./v2/literals.ts";
import { parseCanonicalCentroid, parseRepresentationFamily } from "./v2/centroid.ts";
import {
  parseBoundaryConditions,
  parseDiagnosticNotes,
  parseEdgeCases,
  parseErrorHandling,
  parseInvariants,
} from "./v2/error-aware.ts";
import {
  parseAmbiguities,
  parseAssumptions,
  parseConcurrencyModel,
  parseStateModel,
} from "./v2/orchestration.ts";
import { parseFileFingerprint, parseReconstructionHints } from "./v2/shape.ts";

/**
 * Narrows the file-level fields of a file-analysis response into a total {@link SemanticFields}.
 *
 * @param raw - The untrusted top-level file-analysis response (camelCase v1 fields, snake_case v2 keys).
 * @returns A {@link SemanticFields} with every field present (defaults filled).
 */
export function normalizeAnalysisFields(raw: Record<string, unknown>): SemanticFields {
  const { analysis } = shapeAnalysis(raw as Parameters<typeof shapeAnalysis>[0]);
  return {
    // ---- v1 carryovers ----------------------------------------------------
    purpose: analysis.purpose,
    summary: analysis.summary,
    businessContext: analysis.businessContext,
    classes: analysis.classes,
    functions: analysis.functions,
    keywords: analysis.keywords,
    ontologyConcepts: analysis.ontologyConcepts ?? [],
    businessEntities: analysis.businessEntities ?? [],
    systemCapabilities: analysis.systemCapabilities ?? [],
    configDependencies: analysis.configDependencies ?? [],

    // ---- reshapes (narrowed locally — shapeAnalysis output is intentionally ignored) ----
    importsInternal: parseInternalImports(raw["imports_internal"]),
    importsExternal: parseExternalImports(raw["imports_external"]),
    sideEffects: parseSideEffects(raw["side_effects"]),
    integrationSurface: pickStringArray(raw["integration_surface"]),
    contractsProvided: parseContracts(raw["contracts_provided"]),
    contractsConsumed: parseContracts(raw["contracts_consumed"]),
    sectionMap: parseSectionMap(raw["section_map"]),

    // ---- v2 reconstruction substrate -------------------------------------
    representationFamily: parseRepresentationFamily(raw["representation_family"]),
    representationType: pickString(raw["representation_type"], ""),
    publicSignatures: parsePublicSignatures(raw["public_signatures"]),
    typeShapes: parseTypeShapes(raw["type_shapes"]),
    localCallGraph: parseLocalCallGraph(raw["local_call_graph"]),
    dataFlowGraph: parseDataFlowGraph(raw["data_flow_graph"]),
    verbatimLiterals: parseVerbatimLiterals(raw["verbatim_literals"]),
    canonicalCentroid: parseCanonicalCentroid(raw["canonical_centroid"]),

    // ---- error-aware -----------------------------------------------------
    edgeCases: parseEdgeCases(raw["edge_cases"]),
    boundaryConditions: parseBoundaryConditions(raw["boundary_conditions"]),
    errorHandling: parseErrorHandling(raw["error_handling"]),
    invariants: parseInvariants(raw["invariants"]),
    diagnosticNotes: parseDiagnosticNotes(raw["diagnostic_notes"]),

    // ---- orchestration ---------------------------------------------------
    assumptions: parseAssumptions(raw["assumptions"]),
    ambiguities: parseAmbiguities(raw["ambiguities"]),
    concurrencyModel: parseConcurrencyModel(raw["concurrency_model"]),
    stateModel: parseStateModel(raw["state_model"]),

    // ---- shape + compression --------------------------------------------
    fileFingerprint: parseFileFingerprint(raw["file_fingerprint"]),
    reconstructionHints: parseReconstructionHints(raw["reconstruction_hints"]),
  };
}
