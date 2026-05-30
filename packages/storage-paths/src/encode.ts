/** Folder summaries for the repo root are keyed under this placeholder, since "" is not a filename. */
export const ROOT_FOLDER_PLACEHOLDER = "__ROOT__";

const SLASH_RE = /\//gu;
const BACKSLASH_RE = /\\/gu;
const ENCODED_SLASH_RE = /__SL__/gu;
const ENCODED_BACKSLASH_RE = /__BS__/gu;

/** Flattens a repo-relative path into a single filename segment (slashes → `__SL__`, etc.). */
export function encodeMetaPath(relativePath: string): string {
  return relativePath.replace(SLASH_RE, "__SL__").replace(BACKSLASH_RE, "__BS__");
}

/** Inverse of `encodeMetaPath` — restores a flattened filename segment to its repo-relative path. */
export function decodeMetaPath(encoded: string): string {
  return encoded.replace(ENCODED_SLASH_RE, "/").replace(ENCODED_BACKSLASH_RE, "\\");
}
