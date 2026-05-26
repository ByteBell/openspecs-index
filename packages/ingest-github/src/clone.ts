import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import path from "node:path";
import { GitCloneError } from "@bb/errors";

const exec = promisify(execFile);

export interface CloneOptions {
  repoUrl: string;
  branch: string;
  destDir: string;
  gitToken?: string;
}

export async function gitClone(opts: CloneOptions): Promise<void> {
  const authedUrl = applyToken(opts.repoUrl, opts.gitToken);
  if (await isGitRepo(opts.destDir)) {
    await fetchAndReset(opts.destDir, authedUrl, opts.branch, opts.repoUrl);
    return;
  }
  try {
    await exec("git", ["clone", "--depth=1", "--single-branch", "--branch", opts.branch, authedUrl, opts.destDir]);
  } catch (firstCause: unknown) {
    const detected = await resolveDefaultBranch(authedUrl);
    if (detected !== null && detected !== opts.branch) {
      try {
        await exec("git", ["clone", "--depth=1", "--single-branch", "--branch", detected, authedUrl, opts.destDir]);
        return;
      } catch {
        throw new GitCloneError(opts.repoUrl, firstCause);
      }
    }
    throw new GitCloneError(opts.repoUrl, firstCause);
  }
}

export async function resolveDefaultBranch(authedUrl: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["ls-remote", "--symref", authedUrl, "HEAD"]);
    const match = stdout.match(/ref:\s+refs\/heads\/(\S+)/u);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const s = await stat(path.join(dir, ".git"));
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fetchAndReset(dir: string, authedUrl: string, branch: string, displayUrl: string): Promise<void> {
  try {
    await exec("git", ["-C", dir, "remote", "set-url", "origin", authedUrl]);
    await exec("git", ["-C", dir, "fetch", "--depth=1", "origin", branch]);
    await exec("git", ["-C", dir, "reset", "--hard", `origin/${branch}`]);
  } catch (cause: unknown) {
    throw new GitCloneError(displayUrl, cause);
  }
}

function applyToken(repoUrl: string, gitToken: string | undefined): string {
  if (gitToken === undefined || gitToken.length === 0) {
    return repoUrl;
  }
  const parsed = new URL(repoUrl);
  parsed.username = gitToken;
  parsed.password = "x-oauth-basic";
  return parsed.toString();
}
