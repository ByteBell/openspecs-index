import { Command } from "commander";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { ensureServerRunning, ServerStartTimeoutError } from "./serverSpawn.ts";
import { getJson, HttpClientError, postJson } from "./httpClient.ts";
import { createProgressBar, createSpinner, error, info, list, type ProgressBar } from "./output.ts";
import { startLogTailer, type LogTailer } from "./logTailer.ts";
import { promptForToken } from "./pullPrompts.ts";
import { promptInitialBranch, promptFullBranchSelector } from "./branchPrompts.ts";
import { parseGithubRepo } from "@bb/ingest-github";

interface IndexResponse {
  knowledgeId: string;
  jobId: string;
}

export function buildIndexCommand(): Command {
  const cmd = new Command("index");
  cmd
    .description("Index a remote git repository.")
    .argument("<git-url>", "https URL of the repository")
    .option("--branch <name>", "branch to index (defaults to 'main' on the server)")
    .option("--token <pat>", "GitHub PAT for private repos")
    .option(
      "--verbose",
      "stream the server log file to the terminal during the run (set log level via `bytebell set log-level debug` for finer-grained output)",
    )
    .action(runIndex);
  return cmd;
}

async function runIndex(
  gitUrl: string,
  options: { branch?: string; token?: string; verbose?: boolean },
): Promise<void> {
  if (!/^https?:\/\//u.test(gitUrl)) {
    error(`invalid git URL: ${gitUrl}`, "expected https://… form");
    process.exitCode = 1;
    return;
  }
  let tailer: LogTailer | null = null;
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
    if (options.verbose === true) {
      tailer = await startLogTailer("server");
    }

    const { branch: resolvedBranch, token: activeToken } = await probeRepo(gitUrl, options.branch, options.token);
    if (resolvedBranch === null) {
      // User cancelled during token prompt
      return;
    }

    const body: Record<string, string> = { repoUrl: gitUrl, branch: resolvedBranch };
    if (activeToken !== undefined) {
      body["gitToken"] = activeToken;
    }
    const response = await postJson<IndexResponse>("/api/v1/github/index", body);
    await pollJobStatus(response.knowledgeId, response.jobId);
  } catch (cause: unknown) {
    handleError(cause);
  } finally {
    if (tailer !== null) {
      await tailer.stop();
    }
  }
}

interface RepoStatus {
  knowledgeId: string;
  state: string;
  fileCount: number;
  totalFiles?: number;
  processedFiles?: number;
  failure?: {
    reason: string;
    category: string;
    detail?: string;
  };
}

async function pollJobStatus(knowledgeId: string, jobId: string): Promise<void> {
  const spinner = createSpinner(`Indexing knowledge ${knowledgeId} (job ${jobId})...`);
  let bar: ProgressBar | null = null;
  const pollInterval = 1500;

  while (true) {
    try {
      const status = await getJson<RepoStatus>(`/api/v1/repos/${knowledgeId}`);

      if (status.totalFiles !== undefined && status.totalFiles > 0) {
        if (bar === null) {
          spinner.stop(true, `Starting ingestion for ${knowledgeId}`);
          bar = createProgressBar(`Ingesting ${knowledgeId}`);
        }
        bar.update(status.processedFiles ?? 0, status.totalFiles, `Ingesting ${knowledgeId}`);
      } else {
        spinner.update(`Indexing: ${status.state}${status.fileCount > 0 ? ` (${status.fileCount} files)` : ""}`);
      }

      if (status.state === "PROCESSED") {
        if (bar) {
          bar.stop(true, `Successfully indexed ${knowledgeId} (${status.fileCount} files)`);
        } else {
          spinner.stop(true, `Successfully indexed ${knowledgeId} (${status.fileCount} files)`);
        }
        return;
      }
      if (status.state === "FAILED") {
        const failMsg = `Indexing failed for ${knowledgeId}`;
        if (bar) {
          bar.stop(false, failMsg);
        } else {
          spinner.stop(false, failMsg);
        }
        if (status.failure?.reason !== undefined) {
          error(`Reason: ${status.failure.reason}`);
        }
        if (status.failure?.detail !== undefined) {
          error(`Detail: ${status.failure.detail}`);
        }
        process.exitCode = 1;
        return;
      }
    } catch (cause: unknown) {
      const msg = `Failed to poll status: ${cause instanceof Error ? cause.message : String(cause)}`;
      if (bar) {
        bar.stop(false, msg);
      } else {
        spinner.stop(false, msg);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

interface ProbeResponse {
  status: "ok" | "not_found" | "unauthorized" | "rate_limited" | "error" | "branch_not_found";
  defaultBranch?: string;
  branches?: string[];
  message?: string;
}

async function probeRepo(
  gitUrl: string,
  suppliedBranch?: string,
  suppliedToken?: string,
): Promise<{ branch: string | null; token?: string }> {
  let token = suppliedToken;
  const parsed = parseGithubRepo(gitUrl);
  const repoLabel = parsed ? `${parsed.owner}/${parsed.repo}` : gitUrl;

  // 1. Initial probe to find default branch and check access
  const callProbe = async (t?: string) => {
    try {
      return await postJson<ProbeResponse>("/api/v1/github/probe", { repoUrl: gitUrl, gitToken: t });
    } catch (cause) {
      if (cause instanceof HttpClientError && (cause.status === 401 || cause.status === 404)) {
        return (cause.body as ProbeResponse) || { status: cause.status === 404 ? "not_found" : "unauthorized" };
      }
      throw cause;
    }
  };

  let probe = await callProbe(token);

  // 2. Handle private repo if needed
  if (probe.status === "not_found" || probe.status === "unauthorized") {
    const promptMessage =
      probe.status === "unauthorized"
        ? "The previous token was rejected. Try a different PAT."
        : "This repo looks private. Paste a GitHub PAT with `repo` scope.";
    const tokenResult = await promptForToken(repoLabel, promptMessage);
    if (tokenResult === null) {
      info("Cancelled.");
      return { branch: null };
    }
    token = tokenResult;
    probe = await callProbe(token);
  }

  if (probe.status !== "ok") {
    error(probe.message ?? "Failed to probe repository.");
    return { branch: null };
  }

  // 3. If a branch was already supplied (via flag or URL), just verify it
  const branchFromUrl = parsed?.branch;
  const initialBranch = suppliedBranch ?? branchFromUrl;
  if (initialBranch !== undefined) {
    if (probe.branches && !probe.branches.includes(initialBranch)) {
      error(`Branch '${initialBranch}' not found.`);
      if (probe.branches.length > 0) {
        list("Available branches:", probe.branches.slice(0, 20));
      }
      return { branch: null };
    }
    const res: { branch: string | null; token?: string } = { branch: initialBranch };
    if (token) {
      res.token = token;
    }
    return res;
  }

  // 4. Interactive menu flow
  const defaultBranch = probe.defaultBranch ?? "main";
  const choice = await promptInitialBranch(defaultBranch);
  if (choice === null) {
    info("Cancelled.");
    return { branch: null };
  }

  if (choice === "default") {
    const res: { branch: string | null; token?: string } = { branch: defaultBranch };
    if (token) {
      res.token = token;
    }
    return res;
  }

  // User selected "Other branch..."
  const fullSelection = await promptFullBranchSelector(probe.branches ?? []);
  if (fullSelection === null) {
    info("Cancelled.");
    return { branch: null };
  }

  const res: { branch: string | null; token?: string } = { branch: fullSelection.branch };
  if (token) {
    res.token = token;
  }
  return res;
}

function handleError(cause: unknown): void {
  if (cause instanceof ServerStartTimeoutError) {
    error(cause.message);
  } else if (cause instanceof HttpClientError) {
    error(cause.message);
  } else {
    error(cause instanceof Error ? cause.message : String(cause));
  }
  process.exitCode = 1;
}
