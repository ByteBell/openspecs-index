/**
 * Public surface of the IR graph-storage subpackage. Callers (the strategy's
 * phase entries, or the AI-copilot benchmark) use just these symbols.
 *
 * Typical flow:
 *   1) `ensureIrGraphSchema()` once per process at strategy boot.
 *   2) `storeIrFileAnalysis(ctx, record)` per small-file IrFileAnalysisRecord.
 *   3) `storeIrChunkAnalysis(ctx, record, chunkIndex, totalChunks, startLine, endLine)`
 *      per chunk of a big-file IrFileAnalysisRecord (parent `:File` header is
 *      upserted on the first chunk automatically).
 */
export { ensureIrGraphSchema } from "./schema.ts";
export { storeIrFileAnalysis } from "./store-file.ts";
export { storeIrChunkAnalysis } from "./store-chunk.ts";
export type { IrGraphStorageContext } from "./types.ts";
