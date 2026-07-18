import { opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { SKIP_DIRS, looksBinary, passesPathFilters } from "./filters.ts";
import {
  countLines,
  logCounts,
  newCounts,
  type ScanCounts,
  type ScanLimits,
  type ScanRepositoryDeps,
} from "./scan-helpers.ts";
import { buildEffectiveIgnoreSets } from "./skip-decisions/effective.ts";
import { makeIgnoreSink, type IgnoredFilesTarget, type IgnoreSink } from "./ignored-files.ts";
import { twoPassScan } from "./scan-twopass.ts";
import type { ScanEntry, SkipDeciderInput } from "#src/types/pipeline.ts";

export type { ScanRepositoryDeps } from "./scan-helpers.ts";

/** Resolve the audit target from scan deps; `undefined` (→ no-op sink) unless a knowledgeId is threaded. */
function ignoreTargetFrom(deps: ScanRepositoryDeps): IgnoredFilesTarget | undefined {
  if (deps.knowledgeId === undefined || deps.knowledgeId.length === 0) {
    return undefined;
  }
  return { knowledgeId: deps.knowledgeId, orgId: deps.orgId ?? "", commitHash: deps.commitHash ?? "" };
}

export async function* scanRepository(rootDir: string, deps: ScanRepositoryDeps = {}): AsyncGenerator<ScanEntry> {
  const limits: ScanLimits = {
    absoluteCap: getConfigValue(Config.AbsoluteFileSizeCap),
    bigFileLineThreshold: getConfigValue(Config.BigFileLineThreshold),
  };
  const sink = makeIgnoreSink(ignoreTargetFrom(deps), deps.ignoreSets ?? buildEffectiveIgnoreSets());

  try {
    // Two-pass parallel mode requires both a skip-decider AND a limiter so that
    // pending LLM resolutions can be deduplicated and dispatched concurrently.
    // Without either, fall back to the inline-await walk that's been here all along.
    if (deps.skipDecider !== undefined && deps.limiter !== undefined) {
      yield* twoPassScan(rootDir, limits, deps.skipDecider, deps.limiter, deps, sink);
      return;
    }

    const counts = newCounts();
    yield* walk(rootDir, rootDir, limits, deps, counts, sink);
    logCounts(counts);
  } finally {
    // Flush the audit batch once the walk finishes (or the consumer stops early). Best-effort:
    // `flush` is fail-open, so a Mongo hiccup never surfaces as a scan failure.
    await sink.flush();
  }
}

async function* walk(
  rootDir: string,
  currentDir: string,
  limits: ScanLimits,
  deps: ScanRepositoryDeps,
  counts: ScanCounts,
  sink: IgnoreSink,
): AsyncGenerator<ScanEntry> {
  const dir = await opendir(currentDir);
  for await (const entry of dir) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if ((deps.ignoreSets?.directories ?? SKIP_DIRS).has(entry.name)) {
        sink.recordDir(path.relative(rootDir, abs));
        continue;
      }
      yield* walk(rootDir, abs, limits, deps, counts, sink);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!passesPathFilters(entry.name, path.extname(entry.name), deps.ignoreSets)) {
      sink.recordStatic(path.relative(rootDir, abs), path.extname(entry.name));
      counts.rejectStatic += 1;
      continue;
    }
    const sizeBytes = (await stat(abs)).size;
    const relativePath = path.relative(rootDir, abs);
    const ext = path.extname(entry.name).toLowerCase();
    if (sizeBytes > limits.absoluteCap) {
      counts.oversized += 1;
      yield { kind: "oversized", relativePath, absolutePath: abs, sizeBytes };
      continue;
    }
    const buf = await readFile(abs);
    if (looksBinary(buf)) {
      sink.recordBinary(relativePath);
      counts.binary += 1;
      continue;
    }
    const content = buf.toString("utf8");
    if (countLines(content) > limits.bigFileLineThreshold) {
      counts.oversized += 1;
      yield { kind: "oversized", relativePath, absolutePath: abs, sizeBytes };
      continue;
    }
    if (deps.skipDecider !== undefined) {
      const deciderInput: SkipDeciderInput = { relativePath, absolutePath: abs, ext, content };
      if (deps.llmCallContext !== undefined) {
        deciderInput.llmCallContext = deps.llmCallContext;
      }
      const decision = await deps.skipDecider.decide(deciderInput);
      if (decision === "reject-static") {
        sink.recordStatic(relativePath, ext);
        counts.rejectStatic += 1;
        continue;
      }
      if (decision === "reject-llm") {
        sink.recordLlm(relativePath);
        counts.rejectLlm += 1;
        continue;
      }
      if (decision === "accept-llm") {
        counts.acceptLlm += 1;
      } else {
        counts.acceptStatic += 1;
      }
    } else {
      counts.acceptStatic += 1;
    }
    yield {
      kind: "file",
      relativePath,
      absolutePath: abs,
      sizeBytes,
      content,
    };
  }
}

export async function readScannedFile(absolutePath: string): Promise<string> {
  return await readFile(absolutePath, "utf8");
}
