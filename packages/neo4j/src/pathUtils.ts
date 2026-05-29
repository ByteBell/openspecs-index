// Shared path helpers for the legacy snake_case mirror writes. The legacy
// reader expects FolderNode.level (depth from root) and CONTAINS_FOLDER /
// CONTAINS_FILE edges anchored at parent paths — both derived from the
// existing camelCase folderPath / relativePath strings without changing the
// primary-write Cypher.

/** Depth of the folder path from the repo root. Root ("") is 0. */
export function folderLevel(folderPath: string): number {
  const trimmed = folderPath.replace(/^\/+|\/+$/u, "");
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split("/").length;
}

/**
 * Parent folder path for a folder or file path, or null when the input is
 * already at the repo root (no parent edge needed).
 */
export function parentFolderPath(path: string): string | null {
  const trimmed = path.replace(/^\/+|\/+$/u, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash < 0) {
    return null;
  }
  return trimmed.slice(0, lastSlash);
}

/** Last path segment, used as the display name for files / folders. */
export function basename(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/u, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash < 0) {
    return trimmed;
  }
  return trimmed.slice(lastSlash + 1);
}
