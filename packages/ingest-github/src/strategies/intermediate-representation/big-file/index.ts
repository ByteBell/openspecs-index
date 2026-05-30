/**
 * Public barrel for the IR big-file path (boundary-aware chunking, no condensation). Importers
 * depend ONLY on this file (re-exported from the package `index.ts`), never on internal modules.
 */
export {
  createIrBigFileAnalyzer,
  type IrBigFileAnalyzer,
  type AnalyzeBigFileInput,
  type IrBigFileResult,
  type BigFileChunksResult,
} from "./analyzer.ts";
