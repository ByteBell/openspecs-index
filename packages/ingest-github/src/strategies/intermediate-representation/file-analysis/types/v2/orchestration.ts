/**
 * Orchestration pass-1 fields — what the analyzer assumes, what it is unsure about (cleared by
 * mcp-enrichment in pass-2), and the file's concurrency / state-machine shape.
 */
import type { SourceAnchor } from "./anchors.ts";

/** Closed enum of assumption categories. */
export type AssumptionKind = "caller" | "env" | "config" | "init-order" | "platform" | "schema";

/** A non-obvious assumption the file rests on (caller behavior, env state, init order, etc.). */
export interface Assumption {
  kind: AssumptionKind;
  description: string;
  anchor: SourceAnchor;
}

/** A TBD the analyzer flagged as unresolvable from this file alone — cleared by pass-2. */
export interface Ambiguity {
  question: string;
  affects: string;
  anchor: SourceAnchor;
  /** Filled by mcp-enrichment (pass-2); empty in pass-1. */
  resolution: string | null;
}

/** Closed enum of high-level execution models. */
export type ConcurrencyKind = "sync" | "async" | "streaming" | "event" | "generator" | "mixed";

/** The file's concurrency model — execution kind, reentrancy, ordering guarantees. */
export interface ConcurrencyModel {
  kind: ConcurrencyKind;
  reentrant: boolean;
  ordering: "fifo" | "lifo" | "unordered" | "deterministic" | "non-deterministic" | "unknown";
  notes: string;
}

/** One transition of the file's state machine (when `representationFamily === "state-machine"`). */
export interface StateTransition {
  from: string;
  to: string;
  trigger: string;
  guard: string | null;
  effect: string | null;
  anchor: SourceAnchor;
}

/** State-machine shape — only populated when `representationFamily === "state-machine"`. */
export interface StateModel {
  states: string[];
  initialState: string | null;
  finalStates: string[];
  transitions: StateTransition[];
}
