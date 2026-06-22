import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { IngestError } from "@bb/errors";

const exec = promisify(execFile);

export type DiffStatus = "added" | "modified" | "deleted" | "renamed";

export interface RenamedFile {
  oldPath: string;
  newPath: string;
  similarity: number;
}

export interface DiffResult {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: RenamedFile[];
}

export function emptyDiff(): DiffResult {
  return { added: [], modified: [], deleted: [], renamed: [] };
}

/**
 * Compute `git diff --name-status --find-renames=50 CURRENT..TARGET` in the
 * given repo. Output is interpreted relative to the TARGET side of the
 * comparison, so direction (forward / backward / sideways) does not matter
 * to the caller.
 */
export async function diffCommits(repoDir: string, currentCommit: string, targetCommit: string): Promise<DiffResult> {
  let stdout: string;
  try {
    const result = await exec(
      "git",
      ["-C", repoDir, "diff", "--name-status", "--find-renames=50", `${currentCommit}..${targetCommit}`],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (cause: unknown) {
    throw new IngestError("", `git diff ${currentCommit}..${targetCommit} failed: ${describe(cause)}`, cause);
  }
  return parseDiffOutput(stdout);
}

export function parseDiffOutput(stdout: string): DiffResult {
  const out = emptyDiff();
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    const parts = line.split("\t");
    const code = parts[0];
    if (code === undefined) {
      continue;
    }
    if (code === "A") {
      const path = parts[1];
      if (path !== undefined && path.length > 0) {
        out.added.push(path);
      }
      continue;
    }
    if (code === "M") {
      const path = parts[1];
      if (path !== undefined && path.length > 0) {
        out.modified.push(path);
      }
      continue;
    }
    if (code === "D") {
      const path = parts[1];
      if (path !== undefined && path.length > 0) {
        out.deleted.push(path);
      }
      continue;
    }
    if (code.startsWith("R")) {
      const similarity = parseInt(code.slice(1), 10);
      const oldPath = parts[1];
      const newPath = parts[2];
      if (oldPath !== undefined && newPath !== undefined && oldPath.length > 0 && newPath.length > 0) {
        out.renamed.push({ oldPath, newPath, similarity: Number.isFinite(similarity) ? similarity : 0 });
      }
      continue;
    }
    if (code.startsWith("C")) {
      // Copies: treat as additions of the new path; original is left untouched.
      const newPath = parts[2];
      if (newPath !== undefined && newPath.length > 0) {
        out.added.push(newPath);
      }
      continue;
    }
    // Unknown status (T type-change, U unmerged, X, B). Conservative: ignore.
  }
  return out;
}

/** Returns true if `commitHash` exists in the local clone's object database. */
export async function ensureCommitReachable(repoDir: string, commitHash: string): Promise<boolean> {
  try {
    await exec("git", ["-C", repoDir, "cat-file", "-e", `${commitHash}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Returns true if `commitHash` is an ancestor of (or equal to) `origin/<branch>`. */
export async function assertReachableFromBranch(repoDir: string, commitHash: string, branch: string): Promise<boolean> {
  try {
    await exec("git", ["-C", repoDir, "merge-base", "--is-ancestor", commitHash, `origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** Returns the merge base of `a` and `b`, or null when histories are unrelated. */
export async function mergeBaseOf(repoDir: string, a: string, b: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-C", repoDir, "merge-base", a, b]);
    const value = stdout.trim();
    return value.length === 40 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Deepen the local clone by `depth` more commits on `origin/<branch>`.
 * Returns true when the fetch succeeded, false otherwise. Failures are not
 * fatal — the orchestrator decides what to do.
 */
export async function deepenClone(repoDir: string, branch: string, depth: number): Promise<boolean> {
  try {
    await exec("git", ["-C", repoDir, "fetch", `--deepen=${depth}`, "origin", branch]);
    return true;
  } catch {
    return false;
  }
}

/** Move the working tree to `commitHash` via `git checkout --force`. */
export async function checkoutCommit(repoDir: string, commitHash: string): Promise<void> {
  try {
    await exec("git", ["-C", repoDir, "checkout", "--force", commitHash]);
  } catch (cause: unknown) {
    throw new IngestError("", `git checkout ${commitHash} failed: ${describe(cause)}`, cause);
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
