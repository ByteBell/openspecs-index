/**
 * The REGENERATE call (verify phase, step 1). Asks the model to rebuild a unit's source from
 * its IR alone — raw code out, no JSON. Uses `askLLM` (not `askJsonLLM`) because the response
 * is code. Returns an empty string on failure; config / transport errors bubble up.
 */
import { askLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/reconstruction/types/code-unit.ts";
import {
  REGENERATE_SYSTEM_PROMPT,
  buildRegenerateUserPrompt,
} from "#src/strategies/intermediate-representation/reconstruction/prompts/verify.ts";
import { usageOf } from "#src/strategies/intermediate-representation/usage.ts";

/** The regenerated source plus the call's token usage. */
export interface RegenerateResult {
  regeneratedSource: string;
  tokenUsage: TokenUsage;
}

/**
 * Serializes a unit's IR for regeneration: the reconstruction fields only, with the (empty)
 * fingerprint stripped so it never leaks into the prompt.
 *
 * @param unit - The unit to serialize.
 * @returns A pretty-printed JSON string of the IR.
 */
function serializeIr(unit: CodeUnit): string {
  const { semanticFingerprint: _omit, ...ir } = unit;
  return JSON.stringify(ir, null, 2);
}

/**
 * Runs the regenerate call for one unit.
 *
 * @param unit - The unit whose source to regenerate from its IR.
 * @param llmCallContext - Optional per-call LLM context.
 * @returns The regenerated source and token usage.
 */
export async function regenerateUnit(unit: CodeUnit, llmCallContext?: AskLlmOptions): Promise<RegenerateResult> {
  const userPrompt = buildRegenerateUserPrompt({ unitKind: unit.unitKind, irJson: serializeIr(unit) });
  try {
    const { content, usage } = await askLLM(userPrompt, {
      ...(llmCallContext ?? {}),
      systemPrompt: REGENERATE_SYSTEM_PROMPT,
    });
    return { regeneratedSource: content, tokenUsage: usageOf(usage) };
  } catch (cause: unknown) {
    if (cause instanceof LlmConfigError || cause instanceof LlmError) {
      throw cause;
    }
    const msg = cause instanceof Error ? cause.message : String(cause);
    logger.warn(`regenerateUnit: ${unit.qualifiedName} askLLM failed: ${msg}`);
    return { regeneratedSource: "", tokenUsage: ZERO_USAGE };
  }
}
