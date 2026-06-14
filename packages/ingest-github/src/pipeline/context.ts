import { Config, type IgnoreOverrides, type UsageGuard } from "@bb/types";
import { getConfigValue } from "@bb/config";
import type { AskLlmOptions } from "@bb/llm";
import { buildEffectiveIgnoreSets, type EffectiveIgnoreSets } from "./skip-decisions/effective.ts";

/**
 * Build the per-job effective ignore sets from any overrides carried on the
 * payload. With no overrides this returns the pure seed defaults — identical to
 * the pre-override pipeline. Called once per job; the result is threaded through
 * the strategy context into scan + skip-decider.
 */
export function ignoreSetsFromPayload(payload: { ignoreOverrides?: IgnoreOverrides }): EffectiveIgnoreSets {
  return buildEffectiveIgnoreSets(payload.ignoreOverrides);
}

export function resolveOrgId(payload: { orgId?: string }): string {
  if (typeof payload.orgId === "string" && payload.orgId.length > 0) {
    return payload.orgId;
  }
  return getConfigValue(Config.OrgId);
}

export function llmCallContextFromPayload(payload: {
  llmApiKey?: string;
  llmProvider?: string;
  llmModel?: string;
}): AskLlmOptions | undefined {
  const ctx: AskLlmOptions = {};
  if (payload.llmApiKey !== undefined && payload.llmApiKey.length > 0) {
    ctx.apiKey = payload.llmApiKey;
  }
  if (payload.llmProvider === "openrouter" || payload.llmProvider === "ollama") {
    ctx.provider = payload.llmProvider;
  }
  if (payload.llmModel !== undefined && payload.llmModel.length > 0) {
    ctx.model = payload.llmModel;
  }
  return Object.keys(ctx).length > 0 ? ctx : undefined;
}

/**
 * Build the per-job LLM context for fine-grained (per-unit) analysis: the same credentials and
 * provider as {@link llmCallContextFromPayload}, but with the model swapped to `unitsLlmModel`.
 * Returns `undefined` when no units model is set — callers then fall back to the main context.
 */
export function unitsLlmCallContextFromPayload(payload: {
  llmApiKey?: string;
  llmProvider?: string;
  llmModel?: string;
  unitsLlmModel?: string;
}): AskLlmOptions | undefined {
  // Per-job override wins; otherwise fall back to the deployment-wide `units.model` config
  // (seeded from the `UNITS_MODEL` env). Empty on both → undefined, and the strategy falls back
  // to the main `llmCallContext`.
  const unitsModel =
    payload.unitsLlmModel !== undefined && payload.unitsLlmModel.length > 0
      ? payload.unitsLlmModel
      : getConfigValue(Config.UnitsModel);
  if (unitsModel === undefined || unitsModel.length === 0) {
    return undefined;
  }
  const base = llmCallContextFromPayload(payload) ?? {};
  return { ...base, model: unitsModel };
}

/**
 * Bridge the per-job `usageGuard` onto the LLM call context so every provider
 * call meters its usage progressively. When no guard is present (OSS
 * standalone) the context is returned unchanged — no billing. The callback
 * rides the same `AskLlmOptions` object already threaded to every `askLLM`
 * call, so no extra plumbing is needed in the phases.
 */
export function withUsageMeter(
  ctx: AskLlmOptions | undefined,
  usageGuard: UsageGuard | undefined,
): AskLlmOptions | undefined {
  if (usageGuard === undefined) {
    return ctx;
  }
  return { ...(ctx ?? {}), onUsage: (usage) => usageGuard.meterUsage(usage) };
}
