/**
 * Builds the small "resolution context" string handed to each unit-IR call: the file's imports
 * plus a one-line index of every sibling unit (kind + qualified name). It exists so a unit's IR
 * can resolve calls and types defined elsewhere in the file WITHOUT re-sending the whole file.
 */
import type {
  ModuleIr,
  UnitDescriptor,
} from "#src/strategies/intermediate-representation/reconstruction/types/module-ir.ts";

/**
 * Renders the resolution context for one file.
 *
 * @param module - The file's module IR (its import lists are used).
 * @param units - All units discovered in the file (rendered as a sibling signature index).
 * @returns A compact multi-line string for the unit-IR prompt's CONTEXT block.
 */
export function buildResolutionContext(module: ModuleIr, units: UnitDescriptor[]): string {
  const imports = [...module.importsInternal, ...module.importsExternal];
  const importLine = imports.length > 0 ? `IMPORTS: ${imports.join(", ")}` : "IMPORTS: (none)";
  const siblingLines = units.map((u) => `- ${u.unitKind} ${u.qualifiedName}`);
  return `${importLine}\nUNITS IN FILE:\n${siblingLines.join("\n")}`;
}
