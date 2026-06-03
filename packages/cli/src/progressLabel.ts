// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import type { ProgressBar } from "./output.ts";

/**
 * Progress fields returned by `GET /api/v1/repos/:id`. `progressPercent` is the
 * phase-weighted overall percent (0–100) computed server-side; the file counts
 * are kept for the fallback path and the "(N files)" summary text.
 */
export interface IngestProgressFields {
  totalFiles?: number;
  processedFiles?: number;
  progressPercent?: number;
  currentPhase?: string;
}

const PHASE_LABELS: Record<string, string> = {
  clone: "cloning",
  scan: "scanning",
  file_analysis: "analysing files",
  folder_analysis: "summarising folders",
  indexing: "indexing",
  enrichment: "enriching",
};

/** Human-friendly label for a progress phase, or `null` when none is set. */
export function phaseLabel(phase: string | undefined): string | null {
  if (phase === undefined || phase.length === 0) {
    return null;
  }
  return PHASE_LABELS[phase] ?? phase;
}

/** True once there is something meaningful to show on a progress bar. */
export function hasIngestProgress(status: IngestProgressFields): boolean {
  return status.progressPercent !== undefined || (status.totalFiles !== undefined && status.totalFiles > 0);
}

/**
 * Render a poll snapshot onto the bar. Prefers the phase-weighted percent; falls
 * back to processed/total file counts for older server builds. Appends the
 * current phase name to the label so the user sees what's running.
 */
export function updateIngestBar(bar: ProgressBar, status: IngestProgressFields, baseText: string): void {
  const label = phaseLabel(status.currentPhase);
  const text = label !== null ? `${baseText} — ${label}` : baseText;
  if (status.progressPercent !== undefined) {
    bar.update(status.progressPercent, 100, text);
  } else {
    bar.update(status.processedFiles ?? 0, status.totalFiles ?? 0, text);
  }
}
