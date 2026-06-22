import { createHash } from "node:crypto";

/**
 * Per-file admission-gate dedupe key: hash the content so identical file
 * contents collapse to a single LLM call while distinct files each get their
 * own verdict. Matches the content-hash key used by the decider's `files` cache.
 */
export function decisionKey(content: string): string {
  return `file:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/** Fast newline count (counts LF; a non-empty file is at least one line). */
export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) {
      lines += 1;
    }
  }
  return lines;
}
