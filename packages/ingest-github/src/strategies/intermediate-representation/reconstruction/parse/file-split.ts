/**
 * Narrows the LLM RESPONSE returned by the split call into a {@link FileAnalysisResult}.
 *
 * (The split call = the first LLM call: it is handed the whole file and asked to return a
 * file-level analysis + module structure + the list of code units. This module does not build
 * any prompt — it only validates and shapes the untrusted JSON the model sent back.)
 *
 * The file-level semantic analysis and the reconstruction module fields collapse into one
 * `ModuleIr`; the unit list becomes ordered {@link UnitDescriptor}s. This is the single entry
 * point the splitter analyzer calls; it composes the field-level narrowers.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import { FALLBACK_LANGUAGE } from "#src/types/file-analysis.ts";
import type { FileAnalysisResult } from "#src/strategies/intermediate-representation/reconstruction/types/module-ir.ts";
import { asRecord } from "./primitives.ts";
import { normalizeAnalysisFields } from "./analysis-fields.ts";
import { parseModuleIr } from "./module-ir.ts";
import { parseUnitDescriptors } from "./unit-descriptor.ts";

/**
 * Narrows the untrusted split-call response into a {@link FileAnalysisResult}.
 *
 * @param raw - The untrusted JSON object the model returned from the split call.
 * @param fileNodeId - The source `FileNode` id used to compute unit ids.
 * @returns The module IR (with file-level analysis merged in) plus discovered units.
 */
export function parseFileAnalysisResult(raw: Record<string, unknown>, fileNodeId: string): FileAnalysisResult {
  const top = asRecord(raw) ?? {};
  const language = pickString(top["language"], FALLBACK_LANGUAGE);
  const semantic = normalizeAnalysisFields(top);
  const module = parseModuleIr(top["module"], language, semantic);
  const units = parseUnitDescriptors(top["units"], fileNodeId);
  return { module, units };
}
