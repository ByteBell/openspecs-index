# `@bb/ingest-github/src/pipeline/skip-decisions/prompts`

LLM prompts used by the unknown-extension skip-decision gate.

## Files

- `skip-decision.ts` — `SKIP_DECISION_SYSTEM_PROMPT` (a strict YES/NO rubric
  describing which file types are valuable for code understanding vs. which
  are noise) + `buildSkipDecisionUserPrompt({ relativePath, ext, content,
truncatedTo })`. Prompts are verbatim ports of kube's
  `StreamingFileScanner.shouldProcessUnknownExtension` prompts.

## Invariants

- Pure functions of typed inputs. No I/O, no LLM calls.
- The decider calls `askYesNoLLM(SKIP_DECISION_SYSTEM_PROMPT, …)` and parses
  the response as `.toUpperCase().trim().startsWith("YES" | "NO")`. The
  prompt MUST instruct the model to respond with only "YES" or "NO" so the
  parser succeeds.
