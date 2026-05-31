/**
 * Shape, compression, and reshape pass-1 fields — the file's quantitative fingerprint, the
 * reshaped `sectionMap` and `sideEffects` (replacing v1's looser shapes), and reconstruction
 * hints the regenerator reads to match the file's style.
 */
import type { SourceAnchor } from "./anchors.ts";

/** Quantitative fingerprint of a file's shape — used by the reconstructor as a quick sanity check. */
export interface FileFingerprint {
  lineCount: number;
  declarationCount: number;
  maxNestingDepth: number;
  roughCyclomatic: number;
}

/** Stylistic hints the reconstructor reads to match the file's surface style. */
export interface ReconstructionHints {
  namingStyle: "camelCase" | "snake_case" | "PascalCase" | "kebab-case" | "mixed" | "unknown";
  returnStyle: "explicit" | "implicit-last-expr" | "mixed" | "n/a";
  commentStyle: "line" | "block" | "doc" | "mixed" | "none";
  dialect: string;
}

/** Closed enum of section structural kinds for the reshaped `sectionMap`. */
export type StructureKind =
  | "sequence"
  | "branch"
  | "loop"
  | "try"
  | "async"
  | "generator"
  | "recursion"
  | "io"
  | "declaration";

/**
 * Reshaped section-map entry. The v1 free-prose `description` field is GONE — sections are now
 * described by their `intent` (what they accomplish) and their `structureKind` (how). Conditional
 * and loop sections carry their `predicate` / `branchOutcomes` / `bounds` / `terminationCondition`
 * verbatim; every entry has a `SourceAnchor`.
 */
export interface SectionMapEntry {
  name: string;
  intent: string;
  structureKind: StructureKind;
  predicate: string | null;
  branchOutcomes: string[];
  bounds: string | null;
  terminationCondition: string | null;
  anchor: SourceAnchor;
}

/**
 * Categorized side effects — replaces v1's free `string[]`. Each bucket is a list of
 * one-line observable effects in that category.
 */
export interface SideEffects {
  io: string[];
  network: string[];
  env: string[];
  fs: string[];
  process: string[];
  mutationOfArg: string[];
}
