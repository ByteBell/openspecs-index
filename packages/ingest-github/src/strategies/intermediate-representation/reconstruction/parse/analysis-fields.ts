/**
 * Bridges the flat-folder analysis shaper to the reconstruction IR. Prompt 1 emits the
 * file-level FileAnalysis fields at the TOP LEVEL of its response (the splitter sees the whole
 * file), exactly the camelCase shape `shapeAnalysis` already reads — so we reuse it rather than
 * re-implement narrowing, then fill `undefined` optionals with `""` / `[]` to keep the IR total.
 */
import { shapeAnalysis } from "#src/adapters/llm-file-analyzer.ts";
import type { SemanticFields } from "#src/strategies/intermediate-representation/reconstruction/types/semantics.ts";

/**
 * Narrows the file-level analysis fields of a Prompt 1 response into a total {@link SemanticFields}.
 *
 * @param raw - The untrusted top-level split response (carries the camelCase analysis fields).
 * @returns A {@link SemanticFields} with every field present (defaults filled).
 */
export function normalizeAnalysisFields(raw: Record<string, unknown>): SemanticFields {
  const { analysis } = shapeAnalysis(raw as Parameters<typeof shapeAnalysis>[0]);
  return {
    purpose: analysis.purpose,
    summary: analysis.summary,
    businessContext: analysis.businessContext,
    classes: analysis.classes,
    functions: analysis.functions,
    importsInternal: analysis.importsInternal,
    importsExternal: analysis.importsExternal,
    keywords: analysis.keywords,
    ontologyConcepts: analysis.ontologyConcepts ?? [],
    businessEntities: analysis.businessEntities ?? [],
    systemCapabilities: analysis.systemCapabilities ?? [],
    sideEffects: analysis.sideEffects ?? [],
    configDependencies: analysis.configDependencies ?? [],
    dataFlowDirection: analysis.dataFlowDirection ?? "",
    integrationSurface: analysis.integrationSurface ?? [],
    contractsProvided: analysis.contractsProvided ?? [],
    contractsConsumed: analysis.contractsConsumed ?? [],
    sectionMap: analysis.sectionMap ?? [],
  };
}
