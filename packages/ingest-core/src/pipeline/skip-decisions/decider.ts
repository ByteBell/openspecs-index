import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { askYesNoLLM, type AskLlmOptions } from "@bb/llm";
import { logger } from "@bb/logger";
import type { SkipDecider, SkipDeciderInput, SkipDecision } from "#src/types/pipeline.ts";
import {
  defaultCachePath,
  emptyCache,
  getFileDecision,
  loadCache,
  logCacheSummary,
  saveCache,
  setFileDecision,
  type DecisionsCache,
} from "./cache.ts";
import { matchesAnyGlob } from "./seed.ts";
import { buildEffectiveIgnoreSets, type EffectiveIgnoreSets } from "./effective.ts";
import { SKIP_DECISION_SYSTEM_PROMPT, buildSkipDecisionUserPrompt } from "./prompts/skip-decision.ts";

export interface SkipDeciderDeps {
  repositoryName?: string;
  cachePath?: string;
  /**
   * Effective ignore sets (seed defaults overlaid with any per-job overrides).
   * When omitted, falls back to the pure seed defaults — behavior identical to
   * before per-job overrides existed.
   */
  ignoreSets?: EffectiveIgnoreSets;
}

interface StaticDecisionContext {
  filename: string;
  segments: string[];
}

export function makeSkipDecider(deps: SkipDeciderDeps = {}): SkipDecider {
  const enabled = getConfigValue(Config.SkipDecisionEnabled);
  const cachePath = deps.cachePath ?? defaultCachePath();
  const cache: DecisionsCache = enabled ? loadCache(cachePath) : emptyCache();
  const ignoreSets = deps.ignoreSets ?? buildEffectiveIgnoreSets();
  if (enabled) {
    logCacheSummary(cache);
  }

  function contextFor(input: SkipDeciderInput): StaticDecisionContext {
    const segments = input.relativePath.split("/");
    const filename = segments[segments.length - 1] ?? input.relativePath;
    return { filename, segments };
  }

  function staticDecision(input: SkipDeciderInput): SkipDecision | null {
    const { filename, segments } = contextFor(input);
    for (const segment of segments.slice(0, -1)) {
      if (ignoreSets.directories.has(segment)) {
        return "reject-static";
      }
    }
    if (ignoreSets.filenames.has(filename)) {
      return "reject-static";
    }
    if (input.ext.length > 0 && ignoreSets.extensions.has(input.ext)) {
      return "reject-static";
    }
    if (matchesAnyGlob(filename, ignoreSets.globs)) {
      return "reject-static";
    }

    // Feature flag off: no LLM gate, accept everything that survived the cheap
    // static reject lists above.
    if (!enabled) {
      return "accept";
    }

    // Every file that survives the cheap static rejects must pass the LLM
    // admission gate. The verdict is cached per content-hash, so an unchanged
    // file is a cache hit and a junk file cannot ride a sibling's extension
    // verdict. Without content here, defer to the LLM (resolveLlm reads + hashes).
    const hash = contentHashOf(input);
    if (hash === null) {
      return null;
    }
    const cached = getFileDecision(cache, hash);
    if (cached !== undefined) {
      return cached.ignore ? "reject-llm" : "accept-llm";
    }
    return null;
  }

  async function resolveLlm(input: SkipDeciderInput): Promise<SkipDecision> {
    const content = await resolveContent(input);
    if (content === null) {
      // Unreadable file — default to reject, matching the legacy read-fail path.
      return "reject-llm";
    }
    const decision = await askLlmDecision(input, content, deps.repositoryName, input.llmCallContext);
    if (decision === null) {
      // LLM gave no usable verdict (error / unparseable). Do NOT cache it: caching here would
      // poison the content-hash entry with a transient failure and permanently reject this file on
      // every future re-index (the cache hit short-circuits the LLM). Reject only this run; the next
      // index re-asks once the LLM is healthy.
      return "reject-llm";
    }
    setFileDecision(cache, sha256(content), !decision, "llm", deps.repositoryName, input.relativePath);
    return decision ? "accept-llm" : "reject-llm";
  }

  function persist(): void {
    if (!enabled) {
      return;
    }
    try {
      saveCache(cachePath, cache);
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      logger.warn(`skip-decisions: failed to save cache to ${cachePath}: ${msg}`);
    }
  }

  return {
    async decide(input: SkipDeciderInput): Promise<SkipDecision> {
      const sync = staticDecision(input);
      if (sync !== null) {
        return sync;
      }
      const result = await resolveLlm(input);
      persist();
      return result;
    },
    decideStatic(input: SkipDeciderInput): SkipDecision | null {
      return staticDecision(input);
    },
    async decideAndDeferSave(input: SkipDeciderInput): Promise<SkipDecision> {
      const sync = staticDecision(input);
      if (sync !== null) {
        return sync;
      }
      return await resolveLlm(input);
    },
    persist,
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function contentHashOf(input: SkipDeciderInput): string | null {
  return input.content !== undefined ? sha256(input.content) : null;
}

async function resolveContent(input: SkipDeciderInput): Promise<string | null> {
  if (input.content !== undefined) {
    return input.content;
  }
  try {
    return await readFile(input.absolutePath, "utf8");
  } catch (cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`skip-decisions: cannot read ${input.relativePath} for LLM check (${msg}); defaulting to reject`);
    return null;
  }
}

async function askLlmDecision(
  input: SkipDeciderInput,
  fullContent: string,
  repositoryName: string | undefined,
  llmCallContext: AskLlmOptions | undefined,
): Promise<boolean | null> {
  const maxChars = getConfigValue(Config.SkipDecisionMaxCharsForLlm);
  const content = fullContent.slice(0, maxChars);

  logger.info(
    `skip-decisions: asking LLM about unknown=${input.ext.length > 0 ? input.ext : "<no-ext>"} file=${input.relativePath} repo=${repositoryName ?? "<unknown>"}`,
  );
  const result = await askYesNoLLM(
    SKIP_DECISION_SYSTEM_PROMPT,
    buildSkipDecisionUserPrompt({
      relativePath: input.relativePath,
      ext: input.ext,
      content,
      truncatedTo: content.length,
    }),
    // temperature: 0 makes the yes/no verdict deterministic so the same content
    // never flips between ACCEPT and REJECT across runs. Caller context (model,
    // key, provider) is preserved; it must not override the fixed temperature.
    { ...(llmCallContext ?? {}), temperature: 0 },
  );
  if (result.decision === null) {
    logger.warn(`skip-decisions: LLM returned no decision for ${input.relativePath}; rejecting this run (not cached)`);
    return null;
  }
  logger.info(
    `skip-decisions: LLM decision for ${input.relativePath}: ${result.decision ? "ACCEPT" : "REJECT"} (model=${result.usage.model}, in=${result.usage.inputTokens}, out=${result.usage.outputTokens})`,
  );
  return result.decision;
}

export function repositoryNameFromRepoDir(repoDir: string): string {
  return path.basename(repoDir);
}
