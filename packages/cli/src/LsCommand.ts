import { Command } from "commander";
import { Config, normalizeCommitHashes, resolveIndexedCommit, type KnowledgeSource } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { ensureServerRunning, ServerStartTimeoutError } from "./serverSpawn.ts";
import { getJson, HttpClientError } from "./httpClient.ts";
import { createSpinner, error } from "./output.ts";

interface RepoEntry {
  knowledgeId: string;
  source: KnowledgeSource;
  state: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
}

interface ListResponse {
  repos: RepoEntry[];
}

export function buildLsCommand(): Command {
  const cmd = new Command("ls");
  cmd.description("List indexed knowledge entries.").action(runLs);
  return cmd;
}

async function runLs(): Promise<void> {
  try {
    let ctx: Awaited<ReturnType<typeof ensureServerRunning>>;
    if (
      await fetch(`http://127.0.0.1:${getConfigValue(Config.ServerPort)}/health`)
        .then((r) => r.ok)
        .catch(() => false)
    ) {
      ctx = await ensureServerRunning();
    } else {
      const spinner = createSpinner("Starting ByteBell server in background...");
      ctx = await ensureServerRunning((line) => spinner.update(line));
      spinner.stop(true, `Server started (logs: ${ctx.logPath ?? "n/a"})`);
    }
    const { repos } = await getJson<ListResponse>("/api/v1/repos");
    if (repos.length === 0) {
      process.stdout.write(
        "No indexed knowledge yet. Run `bytebell index <url>` or `bytebell ingest [path]` to add one.\n",
      );
      return;
    }
    renderTable(repos);
    process.stdout.write(`\n${repos.length} ${repos.length === 1 ? "entry" : "entries"}.\n`);
  } catch (cause: unknown) {
    if (cause instanceof ServerStartTimeoutError) {
      error(cause.message);
    } else if (cause instanceof HttpClientError) {
      error(cause.message);
    } else {
      error(cause instanceof Error ? cause.message : String(cause));
    }
    process.exitCode = 1;
  }
}

function renderTable(repos: RepoEntry[]): void {
  const headers = ["ID", "SOURCE", "STATE", "UPDATED", "COMMIT", "COMMITS", "FILES"];
  const rows = repos.map((r) => [
    `${r.knowledgeId.slice(0, 8)}…`,
    formatSource(r.source),
    r.state,
    formatDate(r.updatedAt),
    formatHead(r.source),
    formatCommits(r.source),
    String(r.fileCount),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)));
  const writeRow = (cols: string[]): void => {
    process.stdout.write(cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ") + "\n");
  };
  writeRow(headers);
  for (const row of rows) {
    writeRow(row);
  }
}

function formatHead(source: RepoEntry["source"]): string {
  if (source.kind !== "github") {
    return "-";
  }
  const commitId = resolveIndexedCommit(source);
  if (commitId === undefined) {
    return "-";
  }
  return commitId.slice(0, 8);
}

function formatCommits(source: RepoEntry["source"]): string {
  if (source.kind !== "github") {
    return "-";
  }
  return String(normalizeCommitHashes(source.commitHashes).length);
}

function formatSource(source: RepoEntry["source"]): string {
  if (source.kind === "github") {
    const slug = parseGithubSlug(source.repoUrl);
    const suffix = source.branch !== undefined && source.branch.length > 0 ? `@${source.branch}` : "";
    return `github:${slug}${suffix}`;
  }
  return `local:${source.sourcePath}`;
}

function parseGithubSlug(repoUrl: string): string {
  try {
    const u = new URL(repoUrl);
    return u.pathname.replace(/^\/+/u, "").replace(/\.git$/u, "");
  } catch {
    return repoUrl;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
