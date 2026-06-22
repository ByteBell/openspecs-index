import path from "node:path";
import type { DiffResult } from "./git-diff.ts";

/**
 * Compute the set of direct-parent folders affected by a diff. The set
 * includes the parent of every added, modified, deleted, and renamed path
 * (both old and new). Returns POSIX-style folder paths; the repository root
 * is represented as the empty string.
 */
export function affectedFoldersFromDiff(diff: DiffResult): Set<string> {
  const folders = new Set<string>();
  for (const p of diff.added) {
    folders.add(directFolderOf(p));
  }
  for (const p of diff.modified) {
    folders.add(directFolderOf(p));
  }
  for (const p of diff.deleted) {
    folders.add(directFolderOf(p));
  }
  for (const r of diff.renamed) {
    folders.add(directFolderOf(r.oldPath));
    folders.add(directFolderOf(r.newPath));
  }
  return folders;
}

export function directFolderOf(relativePath: string): string {
  const dir = path.posix.dirname(relativePath.split(path.sep).join("/"));
  if (dir === "." || dir === "/") {
    return "";
  }
  return dir;
}
