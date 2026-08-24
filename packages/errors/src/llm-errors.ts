export class LlmConfigError extends Error {
  override readonly name = "LlmConfigError";
  readonly hint: string;

  /**
   * `hint` is the exact `bytebell set …` command that fixes the problem.
   *
   * The summary is deliberately provider-neutral: this used to hardcode
   * "OpenRouter API key is not configured", so a missing Gemini key or Bedrock
   * region reported a provider the operator had never selected.
   */
  constructor(hint: string, summary = "LLM provider is not fully configured") {
    super(`${summary}. Run:\n  ${hint}`);
    this.hint = hint;
  }
}

export class LlmError extends Error {
  override readonly name = "LlmError";
  /** HTTP status code from the provider when the failure originated from a non-OK response. */
  readonly status?: number;
  /** Raw provider response body (or other structured detail), capped to a sane size by the thrower. */
  readonly detail?: string;

  constructor(message: string, cause?: unknown, options?: { status?: number; detail?: string }) {
    super(message);
    if (cause !== undefined) {
      this.cause = cause;
    }
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.detail !== undefined) {
      this.detail = options.detail;
    }
  }
}
