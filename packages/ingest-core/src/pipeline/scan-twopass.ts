// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
/**
 * Two-pass parallel scan strategy, split out of `scan.ts` to keep both files within the file-size
 * rule. Used when the caller supplies both a skip-decider and a concurrency limiter:
 *
 *   Pass 1 — walk + categorize: static-decided files yield immediately; files needing an LLM
 *            verdict go into `pending`.
 *   Pass 2 — dedupe `pending` by content key, resolve one LLM call per unique key under the
 *            shared limiter, persist the decider cache once.
 *   Pass 3 — drain `pending`; every `decideStatic` is now a cache hit.
 *
 * Every skip site reports to the `IgnoreSink` so the reason lands in the `ignored_files` audit trail.
 */
import { opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "@bb/logger";
import { SKIP_DIRS, looksBinary, passesPathFilters } from "./filters.ts";
import {
  countLines,
  decisionKey,
  logCounts,
  newCounts,
  type ScanLimits,
  type ScanCounts,
  type ScanRepositoryDeps,
} from "./scan-helpers.ts";
import type { IgnoreSink } from "./ignored-files.ts";
import type { ConcurrencyLimiter } from "./concurrency.ts";
import type { ScanEntry, SkipDecider, SkipDeciderInput } from "#src/types/pipeline.ts";

interface PendingFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  content: string;
  ext: string;
  input: SkipDeciderInput;
}

export async function* twoPassScan(
  rootDir: string,
  limits: ScanLimits,
  decider: SkipDecider,
  limiter: ConcurrencyLimiter,
  deps: ScanRepositoryDeps,
  sink: IgnoreSink,
): AsyncGenerator<ScanEntry> {
  const counts = newCounts();
  const pending: PendingFile[] = [];

  // Pass 1: walk + categorize. Static-decided files yield immediately;
  // "needs LLM" files go into `pending` for batch resolution.
  yield* walkAndCategorize(rootDir, rootDir, limits, deps, decider, counts, pending, sink);

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
    // Pending files all reached the LLM gate, so a reject/unresolved here is an LLM-path drop.
    if (decision === "reject-static" || decision === null) {
      sink.recordLlm(p.relativePath);
      counts.rejectStatic += 1;
      continue;
    }
    if (decision === "reject-llm") {
      sink.recordLlm(p.relativePath);
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
      yield* walkAndCategorize(rootDir, abs, limits, deps, decider, counts, pending, sink);
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
    const deciderInput: SkipDeciderInput = { relativePath, absolutePath: abs, ext, content };
    if (deps.llmCallContext !== undefined) {
      deciderInput.llmCallContext = deps.llmCallContext;
    }
    const sync = decider.decideStatic(deciderInput);
    if (sync === "reject-static") {
      sink.recordStatic(relativePath, ext);
      counts.rejectStatic += 1;
      continue;
    }
    if (sync === "reject-llm") {
      sink.recordLlm(relativePath);
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
