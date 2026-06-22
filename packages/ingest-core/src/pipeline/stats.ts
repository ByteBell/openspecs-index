export function repoNameFromUrl(repoUrl: string): string {
  try {
    const segments = new URL(repoUrl).pathname
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const repo = segments.at(-1)?.replace(/\.git$/u, "");
    const owner = segments.at(-2);
    if (owner !== undefined && repo !== undefined) {
      return `${owner}/${repo}`;
    }
  } catch {
    // fall through
  }
  return repoUrl;
}

export function localRepoName(rootDir: string): string {
  const segments = rootDir.split("/").filter((s) => s.length > 0);
  return segments.at(-1) ?? rootDir;
}

export function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
