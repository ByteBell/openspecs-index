/**
 * Deterministic module-level `semanticFingerprint`. Done IN CODE, never by the LLM. The file
 * path is folded in so two files with identical module-level shapes still get distinct
 * fingerprints. A non-empty fingerprint is the marker that the module has been computed
 * (`""` = not yet). Unit fingerprints live next door in `reconstruction/fingerprint.ts`.
 */
import { createHash } from "node:crypto";
import type { ModuleIr } from "./types/module-ir.ts";
import type { UnitConstant } from "./types/named-constant.ts";

/** sha256 hex digest of a string. */
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Serializes constants to a stable string, SORTED (declaration order is not semantically
 * meaningful for the fingerprint). Exported so the unit fingerprint can reuse it.
 *
 * @param constants - The file constants.
 * @returns A deterministic serialization.
 */
export function canonicalizeConstants(constants: UnitConstant[]): string {
  return constants
    .map((c) => `${c.name ?? ""}=${c.value}:${c.kind}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join("|");
}

/**
 * Computes a file's module-level `semanticFingerprint`, unique per file path.
 *
 * @param module - The finalised module IR (its own `semanticFingerprint` is ignored / may be empty).
 * @param filePath - The source file's relative path, folded in for uniqueness.
 * @returns The sha256 hex fingerprint.
 */
export function computeModuleFingerprint(module: ModuleIr, filePath: string): string {
  const canonical = JSON.stringify({
    filePath,
    language: module.language,
    moduleLayout: [...module.moduleLayout].sort(),
    exports: [...module.exports].sort(),
    moduleLevelCode: module.moduleLevelCode ?? "",
    fileConstants: canonicalizeConstants(module.fileConstants),
  });
  return sha256(canonical);
}
