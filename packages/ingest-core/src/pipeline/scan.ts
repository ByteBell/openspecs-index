import { opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import type { AskLlmOptions } from "@bb/llm";
import { logger } from "@bb/logger";
import { SKIP_DIRS, looksBinary, passesPathFilters } from "./filters.ts";
import { countLines, decisionKey } from "./scan-helpers.ts";
import type { EffectiveIgnoreSets } from "./skip-decisions/effective.ts";
import type { ConcurrencyLimiter } from "./concurrency.ts";
import type { ScanEntry, SkipDecider, SkipDeciderInput } from "#src/types/pipeline.ts";

interface ScanLimits {
  absoluteCap: number;
  bigFileLineThreshold: number;
}

export interface ScanRepositoryDeps {
  skipDecider?: SkipDecider;
  llmCallContext?: AskLlmOptions;
  limiter?: ConcurrencyLimiter;
  /**
   * Effective ignore sets (seed defaults overlaid with per-job overrides). Used
   * for directory-walk pruning and the path filter. When omitted, the built-in
   * `SKIP_DIRS` / `SKIP_FILES` / `BINARY_EXTENSIONS` defaults apply (unchanged).
   */
  ignoreSets?: EffectiveIgnoreSets;
}

interface ScanCounts {
  acceptStatic: number;
  acceptLlm: number;
  rejectStatic: number;
  rejectLlm: number;
  oversized: number;
  binary: number;
}

interface PendingFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  content: string;
  ext: string;
  input: SkipDeciderInput;
}

function newCounts(): ScanCounts {
  return { acceptStatic: 0, acceptLlm: 0, rejectStatic: 0, rejectLlm: 0, oversized: 0, binary: 0 };
}

function logCounts(counts: ScanCounts): void {
  logger.info(
    `scan: acceptStatic=${counts.acceptStatic} acceptLlm=${counts.acceptLlm} rejectStatic=${counts.rejectStatic} rejectLlm=${counts.rejectLlm} oversized=${counts.oversized} binary=${counts.binary}`,
  );
}

export async function* scanRepository(rootDir: string, deps: ScanRepositoryDeps = {}): AsyncGenerator<ScanEntry> {
  const limits: ScanLimits = {
    absoluteCap: getConfigValue(Config.AbsoluteFileSizeCap),
    bigFileLineThreshold: getConfigValue(Config.BigFileLineThreshold),
  };

  // Two-pass parallel mode requires both a skip-decider AND a limiter so that
  // pending LLM resolutions can be deduplicated and dispatched concurrently.
  // Without either, fall back to the inline-await walk that's been here all along.
  if (deps.skipDecider !== undefined && deps.limiter !== undefined) {
    yield* twoPassScan(rootDir, limits, deps.skipDecider, deps.limiter, deps);
    return;
  }

  const counts = newCounts();
  yield* walk(rootDir, rootDir, limits, deps, counts);
  logCounts(counts);
}

async function* walk(
  rootDir: string,
  currentDir: string,
  limits: ScanLimits,
  deps: ScanRepositoryDeps,
  counts: ScanCounts,
): AsyncGenerator<ScanEntry> {
  const dir = await opendir(currentDir);
  for await (const entry of dir) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if ((deps.ignoreSets?.directories ?? SKIP_DIRS).has(entry.name)) {
        continue;
      }
      yield* walk(rootDir, abs, limits, deps, counts);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!passesPathFilters(entry.name, path.extname(entry.name), deps.ignoreSets)) {
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
        counts.rejectStatic += 1;
        continue;
      }
      if (decision === "reject-llm") {
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

async function* twoPassScan(
  rootDir: string,
  limits: ScanLimits,
  decider: SkipDecider,
  limiter: ConcurrencyLimiter,
  deps: ScanRepositoryDeps,
): AsyncGenerator<ScanEntry> {
  const counts = newCounts();
  const pending: PendingFile[] = [];

  // Pass 1: walk + categorize. Static-decided files yield immediately;
  // "needs LLM" files go into `pending` for batch resolution.
  yield* walkAndCategorize(rootDir, rootDir, limits, deps, decider, counts, pending);

  // Pass 2: dedupe pending by decision key (extension or filename), schedule
  // one LLM call per unique key through the shared limiter, then persist the
  // decider's cache once.
  if (pending.length > 0) {
    const unique = new Map<string, SkipDeciderInput>();
    for (const p of pending) {
      const key = decisionKey(p.content);
      if (!unique.has(key)) {
        unique.set(key, p.input);
      }
    }
    logger.info(`scan: resolving ${unique.size} unique skip-decision keys for ${pending.length} pending files`);
    await Promise.all(Array.from(unique.values()).map((input) => limiter(() => decider.decideAndDeferSave(input))));
    decider.persist();
  }

  // Pass 3: drain pending. Every decideStatic call is now a cache hit.
  for (const p of pending) {
    const decision = decider.decideStatic(p.input);
    if (decision === "reject-static" || decision === null) {
      counts.rejectStatic += 1;
      continue;
    }
    if (decision === "reject-llm") {
      counts.rejectLlm += 1;
      continue;
    }
    if (decision === "accept-llm") {
      counts.acceptLlm += 1;
    } else {
      counts.acceptStatic += 1;
    }
    yield {
      kind: "file",
      relativePath: p.relativePath,
      absolutePath: p.absolutePath,
      sizeBytes: p.sizeBytes,
      content: p.content,
    };
  }

  logCounts(counts);
}

async function* walkAndCategorize(
  rootDir: string,
  currentDir: string,
  limits: ScanLimits,
  deps: ScanRepositoryDeps,
  decider: SkipDecider,
  counts: ScanCounts,
  pending: PendingFile[],
): AsyncGenerator<ScanEntry> {
  const dir = await opendir(currentDir);
  for await (const entry of dir) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if ((deps.ignoreSets?.directories ?? SKIP_DIRS).has(entry.name)) {
        continue;
      }
      yield* walkAndCategorize(rootDir, abs, limits, deps, decider, counts, pending);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!passesPathFilters(entry.name, path.extname(entry.name), deps.ignoreSets)) {
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
      counts.binary += 1;
      continue;
    }
    const content = buf.toString("utf8");
    if (countLines(content) > limits.bigFileLineThreshold) {
      counts.oversized += 1;
      yield { kind: "oversized", relativePath, absolutePath: abs, sizeBytes };
      continue;
    }
    const deciderInput: SkipDeciderInput = { relativePath, absolutePath: abs, ext, content };
    if (deps.llmCallContext !== undefined) {
      deciderInput.llmCallContext = deps.llmCallContext;
    }
    const sync = decider.decideStatic(deciderInput);
    if (sync === "reject-static") {
      counts.rejectStatic += 1;
      continue;
    }
    if (sync === "reject-llm") {
      counts.rejectLlm += 1;
      continue;
    }
    if (sync === "accept-llm") {
      counts.acceptLlm += 1;
      yield { kind: "file", relativePath, absolutePath: abs, sizeBytes, content };
      continue;
    }
    if (sync === "accept") {
      counts.acceptStatic += 1;
      yield { kind: "file", relativePath, absolutePath: abs, sizeBytes, content };
      continue;
    }
    // sync === null → needs LLM. Defer to pass 2.
    pending.push({ relativePath, absolutePath: abs, sizeBytes, content, ext, input: deciderInput });
  }
}

export async function readScannedFile(absolutePath: string): Promise<string> {
  return await readFile(absolutePath, "utf8");
}
