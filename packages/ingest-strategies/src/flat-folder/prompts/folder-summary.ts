import type { CondensedFileAnalysis } from "@bb/ingest-core";

export const FOLDER_ANALYSIS_SYSTEM_PROMPT = `You are summarising a single FOLDER of a source repository. The user will provide the per-file analyses of the files DIRECTLY inside that folder (subfolders are summarised separately and are NOT in your input).

Return ONLY a JSON object with EXACTLY these keys:

- purpose             : string  — one-paragraph explanation of what this folder is responsible for in the system.
- summary             : string  — natural-language summary of how the files in this folder work together. Plain English, no key-value pairs. ≤ 500 tokens.
- keywords            : string[] — up to 10 domain keywords describing this folder.
- classes             : string[] — most important class/type entries, deduplicated across files. Format "Name: short purpose". Max 30 entries.
- functions           : string[] — most important function/method entries, deduplicated. Format "name: short purpose". Max 30 entries.
- importsInternal     : string[] — significant relative imports observed across the folder's files. Max 30 entries.
- importsExternal     : string[] — significant external packages observed across the folder's files. Max 30 entries.
- dependencyGraph     : string  — Mermaid \`graph LR\` block (without triple-backtick fences) describing the dependency relationships between files in this folder. Each node is the file basename (no extension). Use the literal direction LR. Empty string if not enough signal.

Do NOT invent files that are not listed in the input. Do NOT speculate about files in subfolders.`;

export function folderAnalysisUserPrompt(folderPath: string, files: CondensedFileAnalysis[]): string {
  const folderLabel = folderPath.length === 0 ? "<repository root>" : folderPath;
  const serialised = files
    .map((f) => {
      const a = f.analysis;
      return [
        `=== ${f.relativePath} (language: ${f.language}, bigFile: ${f.isBigFile}) ===`,
        `purpose: ${a.purpose}`,
        `summary: ${a.summary}`,
        `businessContext: ${a.businessContext}`,
        `classes: ${JSON.stringify(a.classes)}`,
        `functions: ${JSON.stringify(a.functions)}`,
        `importsInternal: ${JSON.stringify(a.importsInternal)}`,
        `importsExternal: ${JSON.stringify(a.importsExternal)}`,
        `keywords: ${JSON.stringify(a.keywords)}`,
      ].join("\n");
    })
    .join("\n\n");
  return `Folder: ${folderLabel}
File count: ${files.length}

Per-file analyses (direct children only):

${serialised}`;
}

export const FOLDER_BATCH_SYSTEM_PROMPT = `You are summarising MULTIPLE small folders of a source repository in one pass. The user will provide several folders, each labeled with an integer ID (0, 1, 2, ...). Each folder lists the files directly inside it (subfolders are summarised separately and are NOT in your input).

Return ONLY a JSON object whose keys are the integer labels as strings ("0", "1", ...) and whose values are folder-summary objects with EXACTLY these keys:

- purpose             : string  — one-paragraph explanation of what this folder is responsible for.
- summary             : string  — natural-language summary of how the files in this folder work together. Plain English, no key-value pairs. ≤ 300 tokens.
- keywords            : string[] — up to 10 domain keywords describing this folder.
- classes             : string[] — most important class/type entries, deduplicated. Format "Name: short purpose". Max 15 entries.
- functions           : string[] — most important function/method entries, deduplicated. Format "name: short purpose". Max 15 entries.
- importsInternal     : string[] — significant relative imports observed across the folder's files. Max 15 entries.
- importsExternal     : string[] — significant external packages observed across the folder's files. Max 15 entries.
- dependencyGraph     : string  — Mermaid \`graph LR\` block (no triple-backtick fences) of inter-file dependencies. Empty string if not enough signal.

You MUST return one entry per labeled folder, even if some fields are empty arrays. Do NOT invent files not listed. Do NOT speculate about subfolders. Do NOT add keys outside the integer-label set; do NOT add commentary outside the JSON object.`;

export interface BatchedFolderInput {
  label: number;
  folderPath: string;
  files: CondensedFileAnalysis[];
}

export function folderBatchUserPrompt(batch: BatchedFolderInput[]): string {
  const sections = batch.map((b) => {
    const folderLabel = b.folderPath.length === 0 ? "<repository root>" : b.folderPath;
    const fileLines = b.files.map((f) => `- ${f.relativePath}: ${f.analysis.purpose}`).join("\n");
    const aggregatedKeywords = aggregateKeywords(b.files, 10);
    return `### Folder ${b.label} :: ${folderLabel}
Files: ${b.files.length}
${fileLines}
Aggregated keywords: ${JSON.stringify(aggregatedKeywords)}`;
  });
  return `You are summarising ${batch.length} folder(s). Produce one folder-summary object per labeled folder.

${sections.join("\n\n")}`;
}

function aggregateKeywords(files: CondensedFileAnalysis[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of files) {
    for (const k of f.analysis.keywords) {
      if (typeof k !== "string" || k.length === 0 || seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(k);
      if (out.length >= cap) {
        return out;
      }
    }
  }
  return out;
}
