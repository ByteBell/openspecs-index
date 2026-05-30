/**
 * Round-trip fidelity types (Prompt 3). A unit's IR is regenerated to source (3.1) and the
 * regenerated source is compared to the original (3.2). A failing report drives one retry of
 * Prompt 2 with the `missingFromIr` hints appended.
 */

/** The parsed equivalence report from Prompt 3.2. */
export interface EquivalenceReport {
  semanticEquivalent: boolean;
  passingExampleIo: number;
  totalExampleIo: number;
  /** Behavior present in the ORIGINAL that the IR failed to capture; used as retry hints. */
  missingFromIr: string[];
  reconstructionCompleteness: number;
}

/** The outcome of verifying one unit: the regenerated source plus its equivalence report. */
export interface UnitVerification {
  regeneratedSource: string;
  report: EquivalenceReport;
}
