// Generic, tenant-agnostic knowledge-scope seam. A composition root may register
// a resolver that returns the set of knowledgeIds the current call is allowed to
// read (or null for "no restriction"). Read paths (graph queries, file reads)
// consult `getKnowledgeScope()` and, when non-null, restrict to that set.
//
// Default: no resolver → null → unrestricted. This preserves the single-tenant
// local behaviour; the hook is dormant unless a host opts in.

let knowledgeScopeResolver: (() => string[] | null) | null = null;

/** Register (or clear with null) the process-wide knowledge-scope resolver. */
export function setKnowledgeScopeResolver(fn: (() => string[] | null) | null): void {
  knowledgeScopeResolver = fn;
}

/**
 * The knowledgeId allowlist for the current call, or null when unrestricted.
 * An empty array means "allowed to read nothing".
 */
export function getKnowledgeScope(): string[] | null {
  return knowledgeScopeResolver !== null ? knowledgeScopeResolver() : null;
}
