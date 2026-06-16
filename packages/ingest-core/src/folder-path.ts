import path from "node:path";

export function directFolderOf(relativePath: string): string {
  const dir = path.posix.dirname(relativePath.split(path.sep).join("/"));
  if (dir === "." || dir === "/") {
    return "";
  }
  return dir;
}

export function affectedFolderPaths(relativePaths: string[]): string[] {
  const folders = new Set<string>();
  for (const p of relativePaths) {
    folders.add(directFolderOf(p));
  }
  return [...folders].sort((a, b) => a.length - b.length || a.localeCompare(b));
}
