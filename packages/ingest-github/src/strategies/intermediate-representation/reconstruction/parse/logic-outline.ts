/**
 * Parser for the SCoT `logic_outline` — the core behavioral IR. Steps are restricted to a
 * fixed vocabulary and may nest `children` under `branch` / `loop`. Recursion depth is capped
 * to bound work on adversarial/malformed LLM output.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type { LogicStep } from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import { pickRecordArray } from "./primitives.ts";

const STEP_KINDS = new Set<LogicStep["step"]>(["sequence", "branch", "loop", "return", "raise", "call", "emit"]);

const MAX_DEPTH = 12;

/**
 * Narrows an untrusted step kind to the fixed vocabulary, defaulting to `"sequence"`.
 *
 * @param value - The untrusted `step` field.
 * @returns A valid {@link LogicStep.step}.
 */
function pickStepKind(value: unknown): LogicStep["step"] {
  if (typeof value === "string" && STEP_KINDS.has(value as LogicStep["step"])) {
    return value as LogicStep["step"];
  }
  return "sequence";
}

/**
 * Parses one untrusted record into a {@link LogicStep}, recursing into `children`.
 *
 * @param rec - The untrusted step record.
 * @param depth - Current recursion depth; children beyond {@link MAX_DEPTH} are dropped.
 * @returns The parsed step.
 */
function parseLogicStep(rec: Record<string, unknown>, depth: number): LogicStep {
  const condition = typeof rec["condition"] === "string" && rec["condition"].length > 0 ? rec["condition"] : null;
  return {
    step: pickStepKind(rec["step"]),
    desc: pickString(rec["desc"], ""),
    condition,
    children: depth >= MAX_DEPTH ? [] : parseLogicOutline(rec["children"], depth + 1),
  };
}

/**
 * Parses an untrusted `logic_outline` array into ordered {@link LogicStep}s.
 *
 * @param value - The untrusted `logic_outline` / `children` array.
 * @param depth - Current recursion depth (default `0`).
 * @returns The parsed steps in source order (possibly empty).
 */
export function parseLogicOutline(value: unknown, depth = 0): LogicStep[] {
  if (depth >= MAX_DEPTH) {
    return [];
  }
  return pickRecordArray(value).map((rec) => parseLogicStep(rec, depth));
}
