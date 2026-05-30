/**
 * Projects an `@bb/llm` usage record onto the IR's local {@link TokenUsage} shape. Shared by
 * every phase analyzer so the mapping lives in one place.
 */
import type { AskLlmUsage } from "@bb/llm";
import type { TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";

/**
 * Maps an LLM usage record to a {@link TokenUsage}.
 *
 * @param usage - The usage reported by an `askLLM` / `askJsonLLM` call.
 * @returns The equivalent {@link TokenUsage}.
 */
export function usageOf(usage: AskLlmUsage): TokenUsage {
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd };
}
