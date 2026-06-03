// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import type { ProgressPhase } from "./types.ts";

/**
 * Phase-weighted progress model.
 *
 * The bar must not hit 100% when file analysis finishes — phases that run
 * afterwards (folder summaries, repo summary, graph store, enrichment) need
 * headroom. We give `file_analysis` a granular span (the bulk of the work,
 * the only phase with a real per-file count) and let the later phases step
 * forward to fixed floors on entry. Values are cumulative and monotonic;
 * strategies that skip a phase (concept-graph has no `folder_analysis`,
 * flat-folder has no `enrichment`) simply jump forward.
 */

/** Percent the bar jumps to when a phase begins (the granular span for `file_analysis` is below). */
const PHASE_FLOOR: Record<ProgressPhase, number> = {
  clone: 1,
  scan: 3,
  file_analysis: 5,
  folder_analysis: 72,
  indexing: 82,
  enrichment: 92,
};

const FILE_ANALYSIS_FLOOR = PHASE_FLOOR.file_analysis;
const FILE_ANALYSIS_CEILING = 70;

/** Percent shown on entering `phase` (before any in-phase progress). */
export function phaseFloorPercent(phase: ProgressPhase): number {
  return PHASE_FLOOR[phase];
}

/**
 * Granular percent within the `file_analysis` phase. Maps processed/total
 * onto the `[5, 70]` span; clamps so it never overruns into the later phases.
 */
export function fileAnalysisPercent(processed: number, total: number): number {
  if (total <= 0) {
    return FILE_ANALYSIS_FLOOR;
  }
  const frac = Math.min(1, processed / total);
  return FILE_ANALYSIS_FLOOR + frac * (FILE_ANALYSIS_CEILING - FILE_ANALYSIS_FLOOR);
}
