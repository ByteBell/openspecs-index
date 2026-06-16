import type { FileAnalysis } from "@bb/db-core";

export const FALLBACK_LANGUAGE = "unknown";

export function emptyFileAnalysis(): FileAnalysis {
  return {
    purpose: "",
    summary: "",
    businessContext: "",
    classes: [],
    functions: [],
    importsInternal: [],
    importsExternal: [],
    keywords: [],
  };
}
