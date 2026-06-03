/**
 * Narrows the LLM RESPONSE returned by the file-analysis call into a {@link FileAnalysisResult}.
 *
 * The file-analysis call is handed the whole file (or chunk) and asked to return a file-level
 * analysis + module structure + the list of code units. This module does not build any prompt —
 * it only validates and shapes the untrusted JSON the model sent back.
 *
 * The file-level semantic analysis and the reconstruction module fields collapse into one
 * `ModuleIr`; the unit list becomes ordered {@link UnitDescriptor}s. This is the single entry
 * point `analyseFile` calls; it composes the field-level narrowers.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import { FALLBACK_LANGUAGE } from "#src/types/file-analysis.ts";
import type { FileAnalysisResult } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import { asRecord } from "./primitives.ts";
import { normalizeAnalysisFields } from "./analysis-fields.ts";
import { parseModuleIr } from "./module-ir.ts";
import { parseUnitDescriptors, qnFromLlmId } from "./unit-descriptor.ts";

/**
 * Narrows the untrusted file-analysis response into a {@link FileAnalysisResult}.
 *
 * @param raw - The untrusted JSON object the model returned from the file-analysis call.
 * @param fileNodeId - The source `FileNode` id used to compute unit ids.
 * @param source - The verbatim file (or chunk) text handed to the LLM; unit bodies are sliced
 *   from this locally rather than asked of the model.
 * @returns The module IR (with file-level analysis merged in) plus discovered units.
 */
export function parseFileAnalysisResult(
  raw: Record<string, unknown>,
  fileNodeId: string,
  source: string,
): FileAnalysisResult {
  const top = asRecord(raw) ?? {};
  const language = pickString(top["language"], FALLBACK_LANGUAGE);
  const semantic = normalizeAnalysisFields(top);
  const module = parseModuleIr(top["module"], language, semantic);
  const units = parseUnitDescriptors(top["units"], fileNodeId, source);
  remapModuleContractTestTargets(module, units);
  return { module, units };
}

/**
 * Rewrites each `moduleContractTests[*].targets[]` from the LLM-emitted unit-id form to the
 * canonical `<fileNodeId>__<qn>#<kind>:<qn>` form used by the parsed descriptors. Targets the
 * LLM emitted for a qualified name that has no matching descriptor are dropped.
 */
function remapModuleContractTestTargets(
  module: FileAnalysisResult["module"],
  units: readonly FileAnalysisResult["units"][number][],
): void {
  if (module.moduleContractTests.length === 0) {
    return;
  }
  const byQn = new Map<string, string>();
  for (const u of units) {
    byQn.set(u.qualifiedName, u.unitId);
  }
  for (const test of module.moduleContractTests) {
    const remapped: string[] = [];
    for (const target of test.targets) {
      const qn = qnFromLlmId(target);
      const next = qn !== null ? byQn.get(qn) : undefined;
      if (next !== undefined) {
        remapped.push(next);
      }
    }
    test.targets = remapped;
  }
}
