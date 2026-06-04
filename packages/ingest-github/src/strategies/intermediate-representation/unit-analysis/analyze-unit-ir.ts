/**
 * The unit-IR analysis phase (one LLM call per unit). Hands one unit's verbatim source to the
 * model and shapes the response into a {@link CodeUnit}.
 *
 * Two-phase retry contract:
 *   1) Up to {@link MAX_VALIDATION_RETRIES} attempts on the caller-supplied PRIMARY model
 *      (`llmCallContext.model`). Each attempt's parsed result is validated against
 *      {@link REQUIRED_TOP_LEVEL_KEYS} — every key must appear in the raw JSON AND `summary`
 *      must be non-empty. A retry prepends a corrective preamble naming the missing field(s).
 *   2) If the primary model exhausts its retries, the loop SHIFTS to the first SMARTER model
 *      from `llmCallContext.fallbackModels` and runs up to {@link MAX_VALIDATION_RETRIES} more
 *      attempts. This is on top of `askLLM`'s own transport-level retry — that one handles
 *      5xx / timeouts; this one handles "model responded but cheated on the schema".
 *
 * After both phases are exhausted, the call throws an {@link LlmError} so the upstream phase
 * (analyse-units) marks the unit as `failed` instead of persisting a hollow record.
 */
import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import { ZERO_USAGE, type TokenUsage } from "#src/strategies/intermediate-representation/parse.ts";
import { parseCodeUnit } from "#src/strategies/intermediate-representation/unit-analysis/parse/code-unit.ts";
import type { CodeUnit } from "#src/strategies/intermediate-representation/unit-analysis/types/code-unit.ts";
import type { UnitDescriptor } from "#src/strategies/intermediate-representation/file-analysis/types/module-ir.ts";
import {
  UNIT_IR_SYSTEM_PROMPT,
  buildUnitIrUserPrompt,
} from "#src/strategies/intermediate-representation/unit-analysis/prompts/unit-ir.ts";
import { usageOf } from "#src/strategies/intermediate-representation/usage.ts";

/** Max validation-failure retries PER MODEL before shifting to the next model in the chain. */
const MAX_VALIDATION_RETRIES = 3;

/**
 * Every top-level key the unit-IR JSON shape (see `prompts/unit-ir-fields.ts`) MUST contain.
 * Source of truth: `UNIT_IR_JSON_SHAPE`. Keep this list in lock-step with the prompt — drift
 * means false-positive rejections (rule says present, prompt forgot to ask for it) or false
 * negatives (prompt asks, validator forgets to require it).
 *
 * Validation is presence-only for most keys; `summary` is additionally required to be a
 * non-empty string because every unit_kind has a one-line role and an empty summary is the
 * "model gave up" signal we explicitly retry on.
 */
const REQUIRED_TOP_LEVEL_KEYS = [
  // identity
  "unit_id",
  "unit_kind",
  "name",
  "qualified_name",
  "parent_unit_id",
  // surface
  "signature",
  "parameters",
  "return_type",
  "decorators",
  "modifiers_applied",
  "mutability",
  "visibility",
  "is_async",
  "is_generator",
  "is_abstract",
  "is_static",
  "generic_type_params",
  "base_types",
  "implements",
  "members",
  "member_unit_ids",
  // behaviour
  "summary",
  "preconditions",
  "postconditions",
  "invariants",
  "edge_cases",
  "error_policy",
  "state_mutations",
  "events_emitted",
  "calls",
  "symbol_references",
  "io_format_spec",
  // spec
  "spec_literals",
  "declared_constants",
  "spec_tests",
  "test_references",
] as const;

/**
 * Validates the LLM's raw JSON response against the prompt contract. Returns the human-readable
 * reason a response is bad, or `null` when it passes. Used to decide whether to retry.
 */
function validateRawResponse(raw: Record<string, unknown>): string | null {
  const missing = REQUIRED_TOP_LEVEL_KEYS.filter((k) => !(k in raw));
  if (missing.length > 0) {
    return `missing keys: ${missing.join(", ")}`;
  }
  const summary = raw["summary"];
  if (typeof summary !== "string" || summary.trim().length === 0) {
    return "summary is empty (required for every unit_kind)";
  }
  return null;
}

/** Input to {@link analyzeUnitIr}. */
export interface AnalyzeUnitIrInput {
  descriptor: UnitDescriptor;
  fileId: string;
  language: string;
  relativePath: string;
  /** Imports + sibling signatures, for call/type resolution only. */
  context: string;
  /** `missingFromIr` hints from a failed verification; empty on the first attempt. */
  mustCapture: string[];
  llmCallContext?: AskLlmOptions;
}

/**
 * Result of the unit-IR call. The `codeUnit` here has an empty `semanticFingerprint` — the
 * fingerprint is computed only once the unit is finalised. `model` is the model id the LLM
 * client actually answered with for this call (the surviving fallback, if any); empty when no
 * call succeeded.
 */
export interface AnalyzeUnitIrResult {
  codeUnit: CodeUnit;
  tokenUsage: TokenUsage;
  model: string;
}

interface ModelPhase {
  label: "primary" | "smarter";
  /** Model id to call. Empty string means "no model configured for this phase, skip". */
  model: string;
}

/**
 * Builds the ordered list of (label, model) phases the retry loop will walk. The primary is
 * always present (caller's `llmCallContext.model`). Smarter is the first entry of
 * `fallbackModels`; when no fallback is configured, only the primary phase runs.
 */
function buildModelPhases(llmCallContext: AskLlmOptions | undefined): ModelPhase[] {
  const primary = llmCallContext?.model ?? "";
  const smarter = llmCallContext?.fallbackModels?.[0] ?? "";
  const phases: ModelPhase[] = [{ label: "primary", model: primary }];
  if (smarter.length > 0 && smarter !== primary) {
    phases.push({ label: "smarter", model: smarter });
  }
  return phases;
}

/**
 * Runs the unit-IR analysis call for one unit. See file-level docstring for the two-phase
 * retry contract.
 *
 * @param input - The unit descriptor, file id, language, resolution context, and retry hints.
 * @returns The shaped {@link CodeUnit} (empty fingerprint) plus the call's aggregated token
 *          usage across all attempts that actually executed.
 */
export async function analyzeUnitIr(input: AnalyzeUnitIrInput): Promise<AnalyzeUnitIrResult> {
  const { descriptor, fileId } = input;
  const baseUserPrompt = buildUnitIrUserPrompt({
    language: input.language,
    unitKind: descriptor.unitKind,
    qualifiedName: descriptor.qualifiedName,
    relativePath: input.relativePath,
    context: input.context,
    unitSource: descriptor.source,
    mustCapture: input.mustCapture,
  });

  let aggregatedUsage: TokenUsage = ZERO_USAGE;
  let lastModel = "";
  let lastReason = "";
  const phases = buildModelPhases(input.llmCallContext);

  for (const phase of phases) {
    for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt += 1) {
      const userPrompt =
        attempt === 1 && phase.label === "primary"
          ? baseUserPrompt
          : `PRIOR ATTEMPT REJECTED BY VALIDATOR: ${lastReason}\n` +
            `Re-emit the FULL JSON with every key present. Missing keys cause another retry — wasted tokens.\n\n` +
            baseUserPrompt;

      // Per-attempt call context: pin to THIS phase's model with no inner fallback so this
      // outer loop is the only thing deciding which model runs. Transport-level retries
      // inside askLLM still apply within a single attempt.
      const perAttemptContext: AskLlmOptions = {
        ...(input.llmCallContext ?? {}),
        ...(phase.model.length > 0 ? { model: phase.model } : {}),
        fallbackModels: [],
      };

      try {
        const response = await askJsonLLM<Record<string, unknown>>(
          UNIT_IR_SYSTEM_PROMPT,
          userPrompt,
          perAttemptContext,
        );
        aggregatedUsage = addUsage(aggregatedUsage, usageOf(response.usage));
        lastModel = response.usage.model;

        if (response.result === null) {
          lastReason = "unparseable JSON";
          logger.warn(
            `analyzeUnitIr: ${descriptor.qualifiedName} ${phase.label}(${phase.model}) ` +
              `attempt ${attempt}/${MAX_VALIDATION_RETRIES} — ${lastReason}`,
          );
          continue;
        }
        const rawFailure = validateRawResponse(response.result);
        if (rawFailure !== null) {
          lastReason = rawFailure;
          logger.warn(
            `analyzeUnitIr: ${descriptor.qualifiedName} ${phase.label}(${phase.model}) ` +
              `attempt ${attempt}/${MAX_VALIDATION_RETRIES} — ${rawFailure}`,
          );
          continue;
        }
        const codeUnit = parseCodeUnit(response.result, descriptor, fileId);
        return { codeUnit, tokenUsage: aggregatedUsage, model: lastModel };
      } catch (cause: unknown) {
        if (cause instanceof LlmConfigError) {
          throw cause;
        }
        const msg = cause instanceof Error ? cause.message : String(cause);
        lastReason = `askJsonLLM failed: ${msg}`;
        logger.warn(
          `analyzeUnitIr: ${descriptor.qualifiedName} ${phase.label}(${phase.model}) ` +
            `attempt ${attempt}/${MAX_VALIDATION_RETRIES} — ${lastReason}`,
        );
      }
    }
    logger.warn(
      `analyzeUnitIr: ${descriptor.qualifiedName} ${phase.label}(${phase.model}) ` +
        `exhausted ${MAX_VALIDATION_RETRIES} retries — last reason: ${lastReason}`,
    );
  }

  throw new LlmError(
    "",
    `analyzeUnitIr: ${descriptor.qualifiedName} failed validation across ${phases.length} model phase(s) ` +
      `× ${MAX_VALIDATION_RETRIES} attempts — last reason: ${lastReason}`,
  );
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}
