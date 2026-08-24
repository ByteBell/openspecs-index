// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { LlmError } from "@bb/errors";
import { logger } from "@bb/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Per-attempt resilience for the client-side providers (Anthropic, Bedrock,
// Gemini, Ollama). OpenRouter does not need any of this — it takes a
// server-side `models: [...]` array and reroutes internally.
//
// Why this exists: the model chain is the only resilience a client-side
// provider has, and it collapses. Every non-OpenRouter backend resolves a
// SINGLE-element chain unless the caller passes `opts.fallbackModels`, so one
// 429 or 5xx is a hard failure for that file — and in a pipeline where any file
// failure fails the run, one blip discards an hour of work. BullMQ's
// `attempts: 3` retries the whole job, re-billing every file that already
// succeeded; this retries just the turn that blipped.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

export interface RetryTransientOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base backoff in ms; delay = baseDelayMs × 2^(attempt-1). Default 1000. */
  baseDelayMs?: number;
  /** Short label for logs (e.g. `"anthropic claude-sonnet-5"`). */
  label?: string;
}

/**
 * The provider's own message, so a wrapped error still says WHY it failed.
 *
 * Without this an Anthropic 400 (oversized prompt) and an Anthropic 503 reach
 * the caller as the identical "request failed". That string is what the
 * pipeline persists as its failure detail and what the failure classifier
 * reads to decide whether a run is retryable — so losing the cause turns every
 * provider error into "unreachable".
 */
export function causeMessage(cause: unknown): string {
  if (cause instanceof Error) {
    const status = (cause as { status?: unknown }).status;
    const prefix = typeof status === "number" ? `HTTP ${status}: ` : "";
    return `${prefix}${cause.message}`;
  }
  return String(cause);
}

/**
 * True for errors worth retrying: HTTP 429 / 5xx (provider rate-limit or
 * transient server error) or an aborted (timed-out) request. Everything else —
 * a 400, a refusal, a missing key — is a hard error and must not burn retries.
 * Unwraps `cause`, since providers wrap the transport error in an `LlmError`.
 */
function isTransient(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") {
    return true;
  }
  // A timeout is wrapped as LlmError with the AbortError as its cause; the
  // message is the only thing that survives at the top level.
  if (err instanceof LlmError && err.message.includes("timed out")) {
    return true;
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null && cause !== err) {
    return isTransient(cause);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryTransient<T>(op: () => Promise<T>, options: RetryTransientOptions = {}): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const label = options.label ?? "llm";
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await op();
    } catch (err: unknown) {
      lastError = err;
      if (attempt >= attempts || !isTransient(err)) {
        throw err;
      }
      const wait = baseDelayMs * 2 ** (attempt - 1);
      logger.warn(
        `llm: ${label} transient failure (attempt ${attempt}/${attempts}), retrying in ${wait}ms: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await sleep(wait);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** One model attempt, retried in place on a transient failure. */
export async function attemptWithRetry<T>(label: string, model: string, op: () => Promise<T>): Promise<T> {
  return retryTransient(op, { label: `${label} ${model}` });
}

/**
 * Walk a model chain client-side: one attempt per model (each retried in place
 * on transient failures), next model on any failure, last error surfaced when
 * the chain is dry. This is what OpenRouter gets server-side from its
 * `models: [...]` array; every other backend has to do it here.
 */
export async function walkChain<T>(
  label: string,
  chain: readonly string[],
  attempt: (model: string) => Promise<T>,
): Promise<T> {
  let lastError: Error | null = null;
  for (const model of chain) {
    try {
      return await attemptWithRetry(label, model, () => attempt(model));
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(`llm: ${label} attempt failed (model=${model}) — ${lastError.message}; trying next in chain`);
    }
  }
  throw lastError ?? new LlmError(`${label}: model chain exhausted`);
}
