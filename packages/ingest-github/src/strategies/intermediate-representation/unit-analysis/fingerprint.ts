/**
 * Deterministic `semanticFingerprint` for one CODE UNIT. Done IN CODE, never by the LLM
 * (models are unreliable hashers). The file path is folded in so identical units in different
 * files get distinct fingerprints. A non-empty fingerprint is the marker that a unit has been
 * computed; `""` means "not yet computed". The module-level fingerprint lives in
 * `file-analysis/fingerprint.ts`.
 */
import { createHash } from "node:crypto";
import { canonicalizeConstants } from "#src/strategies/intermediate-representation/file-analysis/fingerprint.ts";
import type { CodeUnit, LogicStep } from "./types/code-unit.ts";

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
