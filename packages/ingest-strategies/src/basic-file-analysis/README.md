# `@bb/ingest-github/src/strategies/basic-file-analysis`

**Archived.** The v2 `flat-folder` strategy has shipped and is now the only
strategy wired into the workers.

This folder retains the v1 `BasicFileAnalysisStrategy` implementation as a
`.archived` file (renamed from `.ts` to keep it out of the TypeScript build).
It is preserved for reference value:

- The v1 single-pass per-file LLM call.
- The v1 diff-mode (`priorShas`) used by the pull worker (now parked).
- The v1 token-breakdown accumulator pattern.

When the pull plan resumes, the diff-mode logic in the archived file is the
historical reference for how prior-sha skipping worked end-to-end. The new
pull plan may or may not bring it forward.

## Files

- `BasicFileAnalysisStrategy.ts.archived` — verbatim v1 source. Not compiled.
- `README.md` — this file.

## Invariants

- This folder is read-only in normal development. New ingestion behavior goes
  in `strategies/flat-folder/`.
- Do not re-export anything from this folder from the package's public
  `index.ts`.
