import type {
  ProgressContext,
  ProgressContextFactory,
  ProgressPhase,
  ProgressReporter,
  ProgressReporterInput,
} from "#src/progress/types.ts";

class NullProgressReporter implements ProgressReporter {
  async start(): Promise<void> {
    /* no-op */
  }
  increment(_delta?: number, _meta?: { fileName?: string }): void {
    /* no-op */
  }
  incrementSeen(_delta?: number): void {
    /* no-op */
  }
  setTotal(_total: number): void {
    /* no-op */
  }
  stop(): void {
    /* no-op */
  }
}

class NullProgressContext implements ProgressContext {
  reporter(_input: ProgressReporterInput): ProgressReporter {
    return new NullProgressReporter();
  }
  phaseChanged(_phase: ProgressPhase): void {
    /* no-op */
  }
  completed(_message?: string): void {
    /* no-op */
  }
  failed(_error: string, _phase?: ProgressPhase, _category?: string, _detail?: string): void {
    /* no-op */
  }
}

const SINGLETON: ProgressContext = new NullProgressContext();

/** Default factory used when no host binary supplies one. */
export const nullProgressContextFactory: ProgressContextFactory = (_knowledgeId: string) => SINGLETON;
