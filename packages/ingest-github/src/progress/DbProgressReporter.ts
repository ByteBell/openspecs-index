import { knowledgeDb } from "@bb/db";
import type {
  ProgressContext,
  ProgressContextFactory,
  ProgressPhase,
  ProgressReporter,
  ProgressReporterInput,
} from "./types.ts";
import { fileAnalysisPercent, phaseFloorPercent } from "./phaseWeights.ts";

class DbProgressContext implements ProgressContext {
  private total = 0;
  private processed = 0;
  private lastUpdate = 0;
  private phase: ProgressPhase = "clone";

  constructor(private knowledgeId: string) {}

  private persist(processed: number, total: number | undefined, percent: number): void {
    knowledgeDb
      .updateKnowledgeProgress(this.knowledgeId, processed, total, {
        progressPercent: Math.round(percent),
        currentPhase: this.phase,
      })
      .catch(() => {});
  }

  reporter(input: ProgressReporterInput): ProgressReporter {
    const isFileAnalysis =
      input.phase === "file_analysis" &&
      (input.subPhase === "analyse_small" || input.subPhase === "big_files_condense");

    return {
      start: async () => {
        if (isFileAnalysis && input.total.kind === "fixed") {
          this.total += input.total.total;
          this.persist(this.processed, this.total, fileAnalysisPercent(this.processed, this.total));
        }
      },
      increment: (delta = 1) => {
        if (isFileAnalysis) {
          this.processed += delta;
          const now = Date.now();
          if (now - this.lastUpdate > 250 || this.processed >= this.total) {
            this.lastUpdate = now;
            this.persist(this.processed, this.total, fileAnalysisPercent(this.processed, this.total));
          }
        }
      },
      incrementSeen: () => {},
      setTotal: (total) => {
        if (isFileAnalysis) {
          this.total = total;
          this.persist(this.processed, this.total, fileAnalysisPercent(this.processed, this.total));
        }
      },
      stop: () => {},
    };
  }

  phaseChanged(phase: ProgressPhase) {
    this.phase = phase;
    if (phase === "clone" || phase === "scan") {
      // Reset the file counter at the start of a run; the bar advances to the
      // phase floor while scanning, before any per-file totals are known.
      this.persist(0, undefined, phaseFloorPercent(phase));
      return;
    }
    // Phases after file analysis (folder_analysis, indexing, enrichment) report
    // no per-file progress — step the bar to the phase floor on entry.
    this.persist(this.processed, this.total, phaseFloorPercent(phase));
  }

  completed() {
    this.persist(this.total, this.total, 100);
  }

  failed() {}
}

export const dbProgressContextFactory: ProgressContextFactory = (knowledgeId: string) => {
  return new DbProgressContext(knowledgeId);
};
