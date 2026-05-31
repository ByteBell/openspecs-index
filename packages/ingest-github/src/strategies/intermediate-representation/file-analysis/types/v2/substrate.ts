/**
 * Pass-1 reconstruction-substrate types — added to the file-analysis call's output. Everything
 * derivable from the file alone that produces Round-Trip Correctness lift over reconstruction-
 * from-signature alone (Allamanis / RTCE): verbatim public signatures, exact type shapes,
 * within-file call + data flow, copied literals, structured import edges, structured contracts,
 * canonical centroid paragraph.
 *
 * Cross-file resolution (`resolvedRelativePath` / `resolvedFileId`) is the mcp-enrichment
 * strategy's job and is left empty by pass-1. The fields are reserved here so pass-2 has a
 * stable home to write into.
 */
import type { SourceAnchor } from "./anchors.ts";

/** Closed enum of representation families a file may declare itself as. */
export type RepresentationFamily =
  | "module"
  | "class-bag"
  | "function-bag"
  | "state-machine"
  | "config"
  | "schema"
  | "script"
  | "test"
  | "fixture"
  | "barrel"
  | "binding"
  | "documentation"
  | "unknown";

/** Verbatim public signature — parameter names, defaults, return type, generics, decorators. */
export interface PublicSignature {
  kind: string;
  name: string;
  signature: string;
  generics: string | null;
  decorators: string[];
  returnType: string | null;
  exported: boolean;
  anchor: SourceAnchor;
}

/** Exact shape of one declared interface / type / enum, with discriminant for unions. */
export interface TypeShape {
  kind: "interface" | "type" | "enum" | "union" | "intersection" | "tuple" | "alias";
  name: string;
  shape: string;
  discriminant: string | null;
  anchor: SourceAnchor;
}

/** Within-file caller→callee edge. */
export interface LocalCallEdge {
  caller: string;
  callee: string;
  origin: "local" | "import" | "this" | "super" | "global";
  kind: "call" | "construct" | "await" | "yield" | "spawn";
  anchor: SourceAnchor;
}

/** Within-file producer→consumer edge with payload + transformation note. */
export interface DataFlowEdge {
  producer: string;
  consumer: string;
  payload: string;
  transformation: string | null;
  anchor: SourceAnchor;
}

/** Categories of verbatim literal pass-1 preserves byte-for-byte. */
export type VerbatimLiteralKind =
  | "regex"
  | "sql"
  | "cypher"
  | "prompt"
  | "error-message"
  | "format-string"
  | "magic-number"
  | "env-key"
  | "url"
  | "header-name"
  | "mime-type"
  | "shell-command";

/** One literal copied byte-for-byte from source. */
export interface VerbatimLiteral {
  kind: VerbatimLiteralKind;
  value: string;
  context: string | null;
  anchor: SourceAnchor;
}

/** Structured internal-import edge — same-knowledge cross-file reference. */
export interface InternalImport {
  spec: string;
  symbols: string[];
  anchor: SourceAnchor;
  /** Resolved by mcp-enrichment (pass-2); empty in pass-1. */
  resolvedRelativePath: string | null;
  /** Resolved by mcp-enrichment (pass-2); empty in pass-1. */
  resolvedFileId: string | null;
}

/** Structured external-import edge — third-party / stdlib reference. */
export interface ExternalImport {
  spec: string;
  symbols: string[];
  package: string | null;
  anchor: SourceAnchor;
}

/** Structured contract entry — replaces the v1 flat string for `contractsProvided` / `contractsConsumed`. */
export interface ContractDescriptor {
  name: string;
  shape: string;
  /** Resolved by mcp-enrichment (pass-2); empty in pass-1. */
  resolvedRelativePath: string | null;
  /** Resolved by mcp-enrichment (pass-2); empty in pass-1. */
  resolvedFileId: string | null;
}

/** ≤ 200-token canonical paragraph the reconstructor reads by default. */
export interface CanonicalCentroid {
  paragraph: string;
  tokenEstimate: number;
}
