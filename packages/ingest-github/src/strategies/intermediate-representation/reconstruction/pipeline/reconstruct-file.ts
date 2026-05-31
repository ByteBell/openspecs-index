/**
 * Deterministically assembles a whole-file source from a `ModuleIr` header and each unit's
 * structurally-regenerated source (bodies replaced with one-line placeholders). No LLM call
 * here — just concatenation in source order. The result is fed to the whole-file judge.
 */
import type { ModuleIr, UnitDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import type { UnitReconstruction } from "#src/strategies/intermediate-representation/reconstruction/types/results.ts";

export interface AssembleFileInput {
  module: ModuleIr;
  /** The pass-1 descriptors, used purely to recover source-order via `startLine`. */
  descriptors: ReadonlyArray<UnitDescriptor>;
  /** Per-unit reconstructions; `verification.regeneratedSource` is the structural skeleton. */
  units: ReadonlyArray<UnitReconstruction>;
}

/**
 * Stitches the assembled file. Order:
 *   1. `module.moduleLevelCode` verbatim (header: SPDX, imports, top-level statements). May
 *      be null — then we emit nothing for the header.
 *   2. Each unit's regenerated source, in original source-order (`startLine` from the
 *      descriptor). Units with empty regenerated source are skipped.
 * Sections are separated by a blank line.
 *
 * @param input - The module IR, original descriptors, and per-unit reconstructions.
 * @returns The assembled file as a single string.
 */
export function assembleFileFromUnits(input: AssembleFileInput): string {
  const descriptorOrder = new Map<string, number>();
  for (const d of input.descriptors) {
    descriptorOrder.set(d.unitId, d.startLine);
  }
  const ordered = [...input.units].sort((a, b) => {
    const ai = descriptorOrder.get(a.codeUnit.unitId) ?? Number.MAX_SAFE_INTEGER;
    const bi = descriptorOrder.get(b.codeUnit.unitId) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  const sections: string[] = [];
  const header = input.module.moduleLevelCode?.trim() ?? "";
  if (header.length > 0) {
    sections.push(header);
  }
  for (const u of ordered) {
    const body = u.verification.regeneratedSource.trim();
    if (body.length > 0) {
      sections.push(body);
    }
  }
  return `${sections.join("\n\n")}\n`;
}
