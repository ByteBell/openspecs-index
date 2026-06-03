/**
 * FolderSpec — the folder-level layer derived from the file-analysis records of every direct
 * child file in a folder. Captures the shared identity of those files: representation family,
 * representation type, concurrency model, reconstruction hints, and language.
 *
 * Generation is **post-hoc and LLM-free** — folder facts are aggregated from per-file fields
 * already on disk. The FolderSpec is a parallel artifact; the per-file records are never
 * mutated. Downstream consumers that want inheritance read both folder + file together.
 *
 * Cohesion threshold: folders with fewer than `MIN_FOLDER_SIZE` direct child files emit no
 * FolderSpec. Agreement threshold: a folder declares a field's value only when at least
 * `AGREEMENT_THRESHOLD` of the contributing files agree.
 */
import type { ConcurrencyModel } from "#src/strategies/intermediate-representation/file-analysis/types/v2/orchestration.ts";
import type { ReconstructionHints } from "#src/strategies/intermediate-representation/file-analysis/types/v2/shape.ts";
import type { RepresentationFamily } from "#src/strategies/intermediate-representation/file-analysis/types/v2/substrate.ts";

/** Minimum number of direct-child files a folder must have before a FolderSpec is derived. */
export const MIN_FOLDER_SIZE = 3;

/** Fraction of contributing files that must agree for a folder to declare a field's value. */
export const AGREEMENT_THRESHOLD = 0.6;

/** The five fields a FolderSpec is allowed to publish for inheritance. */
export interface InheritableFields {
  representationFamily: RepresentationFamily | null;
  representationType: string | null;
  concurrencyModel: ConcurrencyModel | null;
  reconstructionHints: ReconstructionHints | null;
  language: string | null;
}

/**
 * Derived folder-level identity. Every field except `folderPath` and `contributingFiles` is
 * `null` when no consensus emerged across contributing files — null means "no folder claim",
 * NOT "default value". Per-file ModuleIrs only inherit from non-null entries.
 */
export interface FolderSpec extends InheritableFields {
  /** Repo-relative folder path (e.g. `packages/ingest-github/src/strategies`). `""` for repo root. */
  folderPath: string;
  /** Repo-relative paths of every file-analysis record that contributed to this spec. */
  contributingFiles: string[];
  /** ISO timestamp of derivation. */
  derivedAt: string;
}

/** What gets persisted under `metaRoot/folder-specs/<encoded-folder>/spec.json`. */
export interface FolderSpecRecord {
  folderPath: string;
  contributingFiles: string[];
  derivedAt: string;
  spec: InheritableFields;
}
