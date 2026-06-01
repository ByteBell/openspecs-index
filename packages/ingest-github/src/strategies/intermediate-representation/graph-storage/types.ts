/**
 * Flat property bags the graph-storage writers send to Neo4j. Definitions are
 * split across `types/*.ts` to stay under the 300-line rule per file; this
 * barrel re-exports the full surface as a single import path so the project/
 * and write/ modules don't need to know the internal layout.
 */
export * from "./types/core.ts";
export * from "./types/concepts.ts";
export * from "./types/structural.ts";
export * from "./types/substrate.ts";
export * from "./types/graph.ts";
