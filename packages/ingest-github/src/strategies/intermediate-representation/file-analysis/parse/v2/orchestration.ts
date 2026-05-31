/**
 * Narrows the orchestration v2 fields (`assumptions`, `ambiguities`, `concurrency_model`,
 * `state_model`). Pass-1 leaves `ambiguities.resolution` null — mcp-enrichment fills it.
 */
import { pickString, pickStringArray } from "#src/strategies/intermediate-representation/parse.ts";
import type {
  Ambiguity,
  Assumption,
  AssumptionKind,
  ConcurrencyKind,
  ConcurrencyModel,
  StateModel,
  StateTransition,
} from "#src/strategies/intermediate-representation/file-analysis/types/v2/orchestration.ts";
import {
  asRecord,
  pickBool,
  pickRecordArray,
} from "#src/strategies/intermediate-representation/file-analysis/parse/primitives.ts";
import { parseSourceAnchor } from "./anchors.ts";

const ASSUMPTION_KINDS: ReadonlySet<AssumptionKind> = new Set([
  "caller",
  "env",
  "config",
  "init-order",
  "platform",
  "schema",
]);
const CONCURRENCY_KINDS: ReadonlySet<ConcurrencyKind> = new Set([
  "sync",
  "async",
  "streaming",
  "event",
  "generator",
  "mixed",
]);
const ORDERINGS: ReadonlySet<ConcurrencyModel["ordering"]> = new Set([
  "fifo",
  "lifo",
  "unordered",
  "deterministic",
  "non-deterministic",
  "unknown",
]);

/** Returns the string at `key`, or null when absent/empty. */
function optString(rec: Record<string, unknown>, key: string): string | null {
  return typeof rec[key] === "string" && (rec[key] as string).length > 0 ? (rec[key] as string) : null;
}

/** Parses `assumptions` → {@link Assumption}[]. */
export function parseAssumptions(value: unknown): Assumption[] {
  const out: Assumption[] = [];
  for (const rec of pickRecordArray(value)) {
    const description = pickString(rec["description"], "");
    if (description.length === 0) {
      continue;
    }
    const kindRaw = pickString(rec["kind"], "caller");
    out.push({
      kind: ASSUMPTION_KINDS.has(kindRaw as AssumptionKind) ? (kindRaw as AssumptionKind) : "caller",
      description,
      anchor: parseSourceAnchor(rec["anchor"]),
    });
  }
  return out;
}

/** Parses `ambiguities` → {@link Ambiguity}[]. Resolution stays null (filled by mcp-enrichment). */
export function parseAmbiguities(value: unknown): Ambiguity[] {
  const out: Ambiguity[] = [];
  for (const rec of pickRecordArray(value)) {
    const question = pickString(rec["question"], "");
    if (question.length === 0) {
      continue;
    }
    out.push({
      question,
      affects: pickString(rec["affects"], ""),
      anchor: parseSourceAnchor(rec["anchor"]),
      resolution: null,
    });
  }
  return out;
}

/** Default total {@link ConcurrencyModel} when the field is missing or invalid. */
function defaultConcurrencyModel(): ConcurrencyModel {
  return { kind: "sync", reentrant: false, ordering: "unknown", notes: "" };
}

/** Parses `concurrency_model` → {@link ConcurrencyModel}. */
export function parseConcurrencyModel(value: unknown): ConcurrencyModel {
  const rec = asRecord(value);
  if (rec === null) {
    return defaultConcurrencyModel();
  }
  const kindRaw = pickString(rec["kind"], "sync");
  const orderingRaw = pickString(rec["ordering"], "unknown");
  return {
    kind: CONCURRENCY_KINDS.has(kindRaw as ConcurrencyKind) ? (kindRaw as ConcurrencyKind) : "sync",
    reentrant: pickBool(rec["reentrant"]),
    ordering: ORDERINGS.has(orderingRaw as ConcurrencyModel["ordering"])
      ? (orderingRaw as ConcurrencyModel["ordering"])
      : "unknown",
    notes: pickString(rec["notes"], ""),
  };
}

/** Parses one transition record into a {@link StateTransition}, or null on invalid input. */
function parseTransition(rec: Record<string, unknown>): StateTransition | null {
  const from = pickString(rec["from"], "");
  const to = pickString(rec["to"], "");
  if (from.length === 0 || to.length === 0) {
    return null;
  }
  return {
    from,
    to,
    trigger: pickString(rec["trigger"], ""),
    guard: optString(rec, "guard"),
    effect: optString(rec, "effect"),
    anchor: parseSourceAnchor(rec["anchor"]),
  };
}

/**
 * Parses `state_model` → {@link StateModel} or null. Returns null when the field is missing or
 * the record has no states — populated only for state-machine files.
 */
export function parseStateModel(value: unknown): StateModel | null {
  const rec = asRecord(value);
  if (rec === null) {
    return null;
  }
  const states = pickStringArray(rec["states"]);
  if (states.length === 0) {
    return null;
  }
  const initialState = optString(rec, "initial_state");
  const finalStates = pickStringArray(rec["final_states"]);
  const transitions: StateTransition[] = [];
  for (const tr of pickRecordArray(rec["transitions"])) {
    const parsed = parseTransition(tr);
    if (parsed !== null) {
      transitions.push(parsed);
    }
  }
  return { states, initialState, finalStates, transitions };
}
