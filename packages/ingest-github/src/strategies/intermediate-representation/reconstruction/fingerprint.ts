/**
 * Deterministic `semanticFingerprint` computation. The spec is explicit that this is done IN
 * CODE, never by the LLM (models are unreliable hashers).
 *
 * The file path is folded into every hash so the fingerprint is UNIQUE per file: two identical
 * units (or modules) in different files get different fingerprints, and the same unit re-analysed
 * from the same path is stable. A non-empty `semanticFingerprint` is the marker that a unit /
 * module has been computed; `""` means "not yet computed".
 *
 * A unit's fingerprint covers its file path + identity + signature + logic outline + I/O spec +
 * sorted constants; the module's covers its file path + layout / exports / top-level code /
 * file constants.
 */
import { createHash } from "node:crypto";
import type { CodeUnit, LogicStep, UnitConstant } from "./types/code-unit.ts";
import type { ModuleIr } from "./types/module-ir.ts";

/** sha256 hex digest of a string. */
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Serializes a logic outline to a stable string, preserving step ORDER (it is control flow)
 * and recursing into children.
 *
 * @param steps - The ordered logic steps.
 * @returns A deterministic one-line serialization.
 */
function canonicalizeLogicOutline(steps: LogicStep[]): string {
  return steps
    .map((s) => `${s.step}(${s.condition ?? ""}|${s.desc})[${canonicalizeLogicOutline(s.children)}]`)
    .join(";");
}

/**
 * Serializes constants to a stable string, SORTED (declaration order is not semantically
 * meaningful for the fingerprint).
 *
 * @param constants - The unit / file constants.
 * @returns A deterministic serialization.
 */
function canonicalizeConstants(constants: UnitConstant[]): string {
  return constants
    .map((c) => `${c.name ?? ""}=${c.value}:${c.kind}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join("|");
}

/**
 * Computes a code unit's `semanticFingerprint` over its file path + reconstruction-defining
 * fields, making it unique per file.
 *
 * @param unit - The finalised unit (its own `semanticFingerprint` is ignored / may be empty).
 * @param filePath - The source file's relative path, folded in for cross-file uniqueness.
 * @returns The sha256 hex fingerprint.
 */
export function computeUnitFingerprint(unit: CodeUnit, filePath: string): string {
  const canonical = JSON.stringify({
    filePath,
    unitId: unit.unitId,
    signature: unit.signature ?? "",
    logicOutline: canonicalizeLogicOutline(unit.logicOutline),
    ioFormatSpec: unit.ioFormatSpec ?? "",
    constants: canonicalizeConstants(unit.constants),
  });
  return sha256(canonical);
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
