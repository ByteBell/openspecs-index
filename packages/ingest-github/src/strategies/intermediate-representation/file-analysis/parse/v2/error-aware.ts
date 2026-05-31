/**
 * Narrows the error-aware v2 arrays (`edge_cases`, `boundary_conditions`, `error_handling`,
 * `invariants`, `diagnostic_notes`) into their structured forms.
 */
import { pickString } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  BoundaryCondition,
  DiagnosticNote,
  EdgeCase,
  ErrorHandlingItem,
  Invariant,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/error-aware.ts";
import {
  pickBool,
  pickRecordArray,
} from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import { parseSourceAnchor } from "./anchors.ts";

const OPERATORS: ReadonlySet<BoundaryCondition["operator"]> = new Set(["<", "<=", ">", ">=", "==", "!="]);
const INVARIANT_KINDS: ReadonlySet<Invariant["kind"]> = new Set([
  "precondition",
  "postcondition",
  "non-null",
  "ordering",
  "invariant",
]);
const NOTE_CATEGORIES: ReadonlySet<DiagnosticNote["category"]> = new Set([
  "tricky",
  "surprising",
  "bug-magnet",
  "performance",
  "concurrency",
]);

/** Returns the string at `key`, or null when absent/empty. */
function optString(rec: Record<string, unknown>, key: string): string | null {
  return typeof rec[key] === "string" && (rec[key] as string).length > 0 ? (rec[key] as string) : null;
}

/** Parses `edge_cases` → {@link EdgeCase}[]. */
export function parseEdgeCases(value: unknown): EdgeCase[] {
  const out: EdgeCase[] = [];
  for (const rec of pickRecordArray(value)) {
    const inputShape = pickString(rec["input_shape"], "");
    if (inputShape.length === 0) {
      continue;
    }
    out.push({
      inputShape,
      handled: pickBool(rec["handled"]),
      behavior: pickString(rec["behavior"], ""),
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}

/** Parses `boundary_conditions` → {@link BoundaryCondition}[]. */
export function parseBoundaryConditions(value: unknown): BoundaryCondition[] {
  const out: BoundaryCondition[] = [];
  for (const rec of pickRecordArray(value)) {
    const operatorRaw = pickString(rec["operator"], "==");
    const operator: BoundaryCondition["operator"] = OPERATORS.has(operatorRaw as BoundaryCondition["operator"])
      ? (operatorRaw as BoundaryCondition["operator"])
      : "==";
    out.push({
      operator,
      left: pickString(rec["left"], ""),
      right: pickString(rec["right"], ""),
      inclusive: pickBool(rec["inclusive"]),
      intent: pickString(rec["intent"], ""),
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}

/** Parses `error_handling` → {@link ErrorHandlingItem}[]. */
export function parseErrorHandling(value: unknown): ErrorHandlingItem[] {
  const out: ErrorHandlingItem[] = [];
  for (const rec of pickRecordArray(value)) {
    out.push({
      thrown: optString(rec, "thrown"),
      caught: optString(rec, "caught"),
      action: pickString(rec["action"], ""),
      fallback: optString(rec, "fallback"),
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}

/** Parses `invariants` → {@link Invariant}[]. */
export function parseInvariants(value: unknown): Invariant[] {
  const out: Invariant[] = [];
  for (const rec of pickRecordArray(value)) {
    const description = pickString(rec["description"], "");
    if (description.length === 0) {
      continue;
    }
    const kindRaw = pickString(rec["kind"], "invariant");
    out.push({
      kind: INVARIANT_KINDS.has(kindRaw as Invariant["kind"])
        ? (kindRaw as Invariant["kind"])
        : "invariant",
      description,
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}

/** Parses `diagnostic_notes` → {@link DiagnosticNote}[]. */
export function parseDiagnosticNotes(value: unknown): DiagnosticNote[] {
  const out: DiagnosticNote[] = [];
  for (const rec of pickRecordArray(value)) {
    const description = pickString(rec["description"], "");
    if (description.length === 0) {
      continue;
    }
    const categoryRaw = pickString(rec["category"], "tricky");
    out.push({
      category: NOTE_CATEGORIES.has(categoryRaw as DiagnosticNote["category"])
        ? (categoryRaw as DiagnosticNote["category"])
        : "tricky",
      description,
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}
