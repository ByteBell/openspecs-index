import { readFile } from "node:fs/promises";
import path from "node:path";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { askYesNoLLM, type AskLlmOptions } from "@bb/llm";
import { logger } from "@bb/logger";
import type { OversizedReason, SkipDecider, SkipDeciderInput, SkipDecision } from "#src/types/pipeline.ts";
import {
  defaultCachePath,
  emptyCache,
  loadCache,
  logCacheSummary,
  saveCache,
  setExtensionDecision,
  setFilenameDecision,
  setOversizedDecision,
  type DecisionsCache,
} from "./cache.ts";
import {
  SEED_DIRECTORIES,
  SEED_EXTENSIONS,
  SEED_FILENAMES,
  KNOWN_LANGUAGE_EXTENSIONS,
  matchesAnyGlob,
} from "./seed.ts";
import { SKIP_DECISION_SYSTEM_PROMPT, buildSkipDecisionUserPrompt } from "./prompts/skip-decision.ts";

export interface SkipDeciderDeps {
  repositoryName?: string;
  cachePath?: string;
}

interface StaticDecisionContext {
  filename: string;
  segments: string[];
}

export function makeSkipDecider(deps: SkipDeciderDeps = {}): SkipDecider {
  const enabled = getConfigValue(Config.SkipDecisionEnabled);
  const cachePath = deps.cachePath ?? defaultCachePath();
  const cache: DecisionsCache = enabled ? loadCache(cachePath) : emptyCache();
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
      if (SEED_DIRECTORIES.has(segment)) {
        return "reject-static";
      }
    }
    if (SEED_FILENAMES.has(filename)) {
      return "reject-static";
    }
    if (input.ext.length > 0 && SEED_EXTENSIONS.has(input.ext)) {
      return "reject-static";
    }
    if (matchesAnyGlob(filename)) {
      return "reject-static";
    }

    if (input.ext.length > 0 && KNOWN_LANGUAGE_EXTENSIONS.has(input.ext)) {
      return "accept";
    }

    if (!enabled) {
      return "accept";
    }

    const cacheKey = input.ext.length > 0 ? input.ext : filename;
    const section = input.ext.length > 0 ? cache.extensions : cache.filenames;
    const cached = section[cacheKey];
    if (cached !== undefined) {
      return cached.ignore ? "reject-llm" : "accept-llm";
    }
    return null;
  }

  async function resolveLlm(input: SkipDeciderInput): Promise<SkipDecision> {
    const { filename } = contextFor(input);
    const decision = await askLlmDecision(input, deps.repositoryName, input.llmCallContext);
    if (input.ext.length > 0) {
      setExtensionDecision(cache, input.ext, !decision, "llm", deps.repositoryName, input.relativePath);
    } else {
      setFilenameDecision(cache, filename, !decision, "llm", deps.repositoryName, input.relativePath);
    }
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

  function noteOversized(input: { relativePath: string; sizeBytes: number; reason: OversizedReason }): void {
    if (!enabled) {
      return;
    }
    setOversizedDecision(cache, input.relativePath, input.sizeBytes, input.reason, deps.repositoryName);
    persist();
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
    noteOversized,
  };
}

async function askLlmDecision(
  input: SkipDeciderInput,
  repositoryName: string | undefined,
  llmCallContext: AskLlmOptions | undefined,
): Promise<boolean> {
  const maxChars = getConfigValue(Config.SkipDecisionMaxCharsForLlm);
  let content: string;
  if (input.content !== undefined) {
    content = input.content.slice(0, maxChars);
  } else {
    try {
      const raw = await readFile(input.absolutePath, "utf8");
      content = raw.slice(0, maxChars);
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      logger.warn(`skip-decisions: cannot read ${input.relativePath} for LLM check (${msg}); defaulting to reject`);
      return false;
    }
  }

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
    llmCallContext ?? {},
  );
  if (result.decision === null) {
    logger.warn(`skip-decisions: LLM returned no decision for ${input.relativePath}; defaulting to reject`);
    return false;
  }
  logger.info(
    `skip-decisions: LLM decision for ${input.relativePath}: ${result.decision ? "ACCEPT" : "REJECT"} (model=${result.usage.model}, in=${result.usage.inputTokens}, out=${result.usage.outputTokens})`,
  );
  return result.decision;
}

export function repositoryNameFromRepoDir(repoDir: string): string {
  return path.basename(repoDir);
}
