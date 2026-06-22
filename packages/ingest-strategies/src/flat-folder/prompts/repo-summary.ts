export interface RepoFolderInfo {
  folderPath: string;
  purpose: string;
  summary: string;
  keywords: string[];
}

export const REPO_SUMMARY_SYSTEM_PROMPT = `You are summarising an entire source repository using its folder-level summaries (one bullet per folder).

Return ONLY a JSON object with EXACTLY these keys:

- purpose            : string   — one-paragraph explanation of what the repository exists for.
- summary            : string   — natural-language summary of the repository as a whole. Plain English, no key-value pairs. ≤ 800 tokens.
- keywords           : string[] — up to 15 keywords characterising the whole repo.
- architecture       : string   — short paragraph describing the architectural shape (layered, hexagonal, micro-services, monorepo of packages, etc.).
- majorSubsystems    : string[] — up to 10 names of the major subsystems the repo contains.
- dataFlow           : string   — short paragraph describing how data flows through the system end-to-end.
- keyPatterns        : string[] — up to 10 design patterns / idioms used across the repo.

Do NOT invent folders or files. Base every conclusion on the input folder summaries.`;

export function buildRepoPromptFromFolders(folders: RepoFolderInfo[]): string {
  const serialised = folders
    .map(
      (f) =>
        `- ${f.folderPath.length === 0 ? "<root>" : f.folderPath}\n  purpose: ${f.purpose}\n  summary: ${f.summary}\n  keywords: ${JSON.stringify(f.keywords)}`,
    )
    .join("\n\n");
  return `Folder count: ${folders.length}

Folder summaries (sorted shallowest-first):

${serialised}`;
}

export function buildRepoMergePrompt(partials: string[]): string {
  return `You produced ${partials.length} partial repository summaries because the input did not fit in one prompt. Merge them into ONE final JSON object using the same field schema. Prefer concrete claims; drop generic filler.

Partial summaries:

${partials.map((p, i) => `--- Partial ${i + 1} ---\n${p}`).join("\n\n")}`;
}

export function repoFolderInfosFrom(
  folders: Array<{ folderPath: string; purpose: string; summary: string; keywords: string[] }>,
): RepoFolderInfo[] {
  return folders.map((f) => ({
    folderPath: f.folderPath,
    purpose: f.purpose,
    summary: f.summary,
    keywords: f.keywords,
  }));
}
