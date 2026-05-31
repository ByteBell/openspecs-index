/**
 * Source-anchored span used by every v2 field that points back to verbatim text. Anchors are
 * inclusive 1-based line numbers in the source file (or chunk).
 */
export interface SourceAnchor {
  startLine: number;
  endLine: number;
}
