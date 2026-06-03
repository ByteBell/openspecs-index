import { Command } from "commander";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { ensureServerRunning } from "./serverSpawn.ts";
import { ServerStartTimeoutError } from "@bb/errors";
import { getJson, HttpClientError, postJson } from "./httpClient.ts";
import { createProgressBar, createSpinner, error, type ProgressBar } from "./output.ts";
import { hasIngestProgress, updateIngestBar, type IngestProgressFields } from "./progressLabel.ts";

interface IngestResponse {
  knowledgeId: string;
  jobId: string;
}

export function buildIngestCommand(): Command {
  const cmd = new Command("ingest");
  cmd
    .description("Ingest a local directory (defaults to the current working directory).")
    .argument("[path]", "path to a local directory containing the source tree")
    .action(runIngest);
  return cmd;
}

async function runIngest(rawPath: string | undefined): Promise<void> {
  const sourcePath = path.resolve(rawPath ?? process.cwd());
  try {
    const s = await stat(sourcePath);
    if (!s.isDirectory()) {
      error(`Not a directory: ${sourcePath}`);
      process.exitCode = 1;
      return;
    }
  } catch {
    error(`Path does not exist: ${sourcePath}`);
    process.exitCode = 1;
    return;
  }

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
    const response = await postJson<IngestResponse>("/api/v1/local/index", { sourcePath });
    await pollJobStatus(response.knowledgeId, response.jobId);
  } catch (cause: unknown) {
    handleError(cause);
  }
}

interface RepoStatus extends IngestProgressFields {
  knowledgeId: string;
  state: string;
  fileCount: number;
}

async function pollJobStatus(knowledgeId: string, jobId: string): Promise<void> {
  const spinner = createSpinner(`Ingesting knowledge ${knowledgeId} (job ${jobId})...`);
  let bar: ProgressBar | null = null;
  const pollInterval = 1500;

  while (true) {
    try {
      const status = await getJson<RepoStatus>(`/api/v1/repos/${knowledgeId}`);

      if (hasIngestProgress(status)) {
        if (bar === null) {
          spinner.stop(true, `Starting ingestion for ${knowledgeId}`);
          bar = createProgressBar(`Ingesting ${knowledgeId}`);
        }
        updateIngestBar(bar, status, `Ingesting ${knowledgeId}`);
      } else {
        spinner.update(`Ingesting: ${status.state}${status.fileCount > 0 ? ` (${status.fileCount} files)` : ""}`);
      }

      if (status.state === "PROCESSED") {
        if (bar) {
          bar.stop(true, `Successfully ingested ${knowledgeId} (${status.fileCount} files)`);
        } else {
          spinner.stop(true, `Successfully ingested ${knowledgeId} (${status.fileCount} files)`);
        }
        return;
      }
      if (status.state === "FAILED") {
        if (bar) {
          bar.stop(false, `Ingestion failed for ${knowledgeId}`);
        } else {
          spinner.stop(false, `Ingestion failed for ${knowledgeId}`);
        }
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
