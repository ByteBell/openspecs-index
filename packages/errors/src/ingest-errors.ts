export class GitCloneError extends Error {
  override readonly name = "GitCloneError";

  constructor(repoUrl: string, cause: unknown) {
    super(`git clone failed for ${redactUrl(repoUrl)}: ${describe(cause)}`);
    this.cause = cause;
  }
}

export class IngestError extends Error {
  override readonly name = "IngestError";
  readonly knowledgeId: string;

  constructor(knowledgeId: string, message: string, cause?: unknown) {
    super(`[knowledgeId=${knowledgeId}] ${message}`);
    this.knowledgeId = knowledgeId;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * The source repository is gone or inaccessible — a TERMINAL pull failure that no
 * retry will fix (repo deleted/renamed, or private + token lacks access; the git
 * remote returns the same "Repository not found" for all three). Thrown when the
 * clone-server's /compare answers 404. The failure classifier maps this to the
 * non-retryable `repo_unavailable` category so the knowledge is marked CORRUPTED
 * instead of being re-pulled on every auto-pull sweep.
 */
export class RepoUnavailableError extends Error {
  override readonly name = "RepoUnavailableError";

  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class IngestPathError extends Error {
  override readonly name = "IngestPathError";
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`${reason}: ${path}`);
    this.path = path;
  }
}

export class CancellationError extends Error {
  override readonly name = "CancellationError";
  readonly knowledgeId: string;

  constructor(knowledgeId: string) {
    super(`ingestion cancelled: ${knowledgeId}`);
    this.knowledgeId = knowledgeId;
  }
}

export interface UsageLimitExceededDetail {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class UsageLimitExceededError extends Error {
  override readonly name = "UsageLimitExceededError";
  readonly knowledgeId: string;
  readonly phase: string;
  readonly cumulative: UsageLimitExceededDetail;
  readonly current: number;
  readonly max: number;

  constructor(knowledgeId: string, phase: string, cumulative: UsageLimitExceededDetail, current: number, max: number) {
    super(
      `[knowledgeId=${knowledgeId}] usage limit exceeded at phase=${phase} (current=${current}, max=${max}, cumulativeTokens=${
        cumulative.inputTokens + cumulative.outputTokens
      })`,
    );
    this.knowledgeId = knowledgeId;
    this.phase = phase;
    this.cumulative = cumulative;
    this.current = current;
    this.max = max;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function redactUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/u, "//$1:***@");
}
