/**
 * Disk-cached wrapper around {@link extractUnit}. Reads an existing `<name>.analysis.json` if
 * present (presence + parse-OK = cache hit, no LLM call) and otherwise runs {@link extractUnit}
 * and writes the result. The on-disk schema is the bare {@link ExtractUnitResult} so callers
 * can compose this helper with any persistence layout — Phase 7's `IrUnitAnalysisRecord`
 * embeds the same fields, and the benchmark runners write their per-unit cache in this shape.
 *
 * No directory creation here — callers pass an absolute `cachePath` whose parent exists.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { logger } from "@bb/logger";
import type { CodeUnit } from "#src/strategies/intermediate-representation/unit-analysis/types/code-unit.ts";
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { extractUnit, type ExtractUnitInput, type ExtractUnitResult } from "./extract-unit.ts";

/** Input to {@link extractUnitCached}. */
export interface ExtractUnitCachedInput extends ExtractUnitInput {
  /** Absolute path of the per-unit analysis cache file (`<safeUnit>.analysis.json`). */
  cachePath: string;
}

/** Result of {@link extractUnitCached}: the extract result + whether it came from the cache. */
export interface ExtractUnitCachedResult {
  result: ExtractUnitResult;
  cached: boolean;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recognises the canonical `{ codeUnit, attempts, tokenUsage, model }` shape AND the legacy
 * benchmark-runner shape `{ ir, attempts, tokenUsage, model, qualifiedName }` (older
 * `report.ts` wrote `ir` instead of `codeUnit`). When the legacy shape is detected, the
 * `ir` field is treated as `codeUnit`.
 */
function readExtractResult(raw: unknown): ExtractUnitResult | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r["attempts"] !== "number") {
    return null;
  }
  if (r["tokenUsage"] === null || typeof r["tokenUsage"] !== "object") {
    return null;
  }
  const codeUnitField = r["codeUnit"] !== undefined && r["codeUnit"] !== null && typeof r["codeUnit"] === "object"
    ? r["codeUnit"]
    : r["ir"] !== undefined && r["ir"] !== null && typeof r["ir"] === "object"
      ? r["ir"]
      : null;
  if (codeUnitField === null) {
    return null;
  }
  return {
    codeUnit: codeUnitField as CodeUnit,
    attempts: r["attempts"] as number,
    tokenUsage: r["tokenUsage"] as TokenUsage,
    model: typeof r["model"] === "string" ? (r["model"] as string) : "",
  };
}

/**
 * Returns the cached extract result if `cachePath` exists and parses into the expected shape;
 * otherwise calls {@link extractUnit} and writes its result to `cachePath` before returning.
 *
 * @param input - The extract input plus the absolute cache path.
 * @returns The extract result and a `cached` flag (true when the LLM call was skipped).
 */
export async function extractUnitCached(input: ExtractUnitCachedInput): Promise<ExtractUnitCachedResult> {
  const tag = `${input.relativePath}::${input.descriptor.qualifiedName}`;
  if (await exists(input.cachePath)) {
    try {
      const raw: unknown = JSON.parse(await readFile(input.cachePath, "utf8"));
      const cached = readExtractResult(raw);
      if (cached !== null) {
        logger.info(`extractUnitCached: HIT ${tag} (model=${cached.model || "?"})`);
        return { result: cached, cached: true };
      }
      logger.warn(`extractUnitCached: cache file ${input.cachePath} failed shape check; re-extracting`);
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      logger.warn(`extractUnitCached: cache file ${input.cachePath} unreadable (${msg}); re-extracting`);
    }
  } else {
    logger.debug(`extractUnitCached: MISS ${tag} — running extractUnit`);
  }
  const { cachePath: _cachePath, ...extractInput } = input;
  const result = await extractUnit(extractInput);
  const payload: ExtractUnitResult = {
    codeUnit: result.codeUnit,
    attempts: result.attempts,
    tokenUsage: result.tokenUsage,
    model: result.model,
  };
  await writeFile(input.cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  logger.info(
    `extractUnitCached: WROTE ${tag} → ${input.cachePath} ` +
      `(tokens in/out=${result.tokenUsage.inputTokens}/${result.tokenUsage.outputTokens} model=${result.model || "?"})`,
  );
  return { result, cached: false };
}
