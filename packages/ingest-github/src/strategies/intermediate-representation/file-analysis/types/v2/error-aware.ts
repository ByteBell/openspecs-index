/**
 * Error-aware pass-1 fields — capture what today's free-prose analysis silently drops:
 * input shapes, boundary inclusivity, throw/catch paths, invariants, and surprising passages.
 */
import type { SourceAnchor } from "./anchors.ts";

/** One input shape and how the code handles it. */
export interface EdgeCase {
  inputShape: string;
  handled: boolean;
  behavior: string;
  anchor: SourceAnchor;
}

/** One comparison or range check, with its inclusivity made explicit. */
export interface BoundaryCondition {
  operator: "<" | "<=" | ">" | ">=" | "==" | "!=";
  left: string;
  right: string;
  inclusive: boolean;
  intent: string;
  anchor: SourceAnchor;
}

/** One error path: where it originates, who catches it, what happens, and the fallback. */
export interface ErrorHandlingItem {
  thrown: string | null;
  caught: string | null;
  action: string;
  fallback: string | null;
  anchor: SourceAnchor;
}

/** A pre/post-condition, non-null promise, or ordering invariant. */
export interface Invariant {
  kind: "precondition" | "postcondition" | "non-null" | "ordering" | "invariant";
  description: string;
  anchor: SourceAnchor;
}

/** A tricky/surprising/bug-magnet passage the analyzer flagged for a future reader. */
export interface DiagnosticNote {
  category: "tricky" | "surprising" | "bug-magnet" | "performance" | "concurrency";
  description: string;
  anchor: SourceAnchor;
}
