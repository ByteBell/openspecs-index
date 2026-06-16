import type { GithubPullPayload, JobMessage, UsageGuard } from "@bb/types";
import type { ArchiveSink, PullFactory, SourceReader, PipelineSummary } from "#src/types/pipeline.ts";
import type { DiffResult } from "#src/pipeline/git-diff.ts";
import type { RepoLocation } from "#src/pipeline/paths.ts";
import type { ProgressContextFactory } from "#src/progress/types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Provider-agnostic pull seam.
//
// A pull driver (e.g. the flat-folder pull in @bb/ingest-strategies) is given a
// `PullSourceResolver` by the composition root. The resolver is the provider's
// job: it resolves the target commit, clones/streams the source, computes the
// diff, and returns a provider-neutral `PullSourceResolution`. The driver then
// runs the strategy's analysis phases over `source` + `diff` without ever
// importing a provider.
// ─────────────────────────────────────────────────────────────────────────────

export type PullSourceResolution =
  | { kind: "noop"; targetCommit: string }
  | {
      kind: "ready";
      source: SourceReader;
      diff: DiffResult;
      targetCommit: string;
      location: RepoLocation;
      // Repo coordinates resolved by the provider (owner/repo for github+gitlab).
      // Surfaced here so the driver doesn't have to narrow the `RepoLocation`
      // union to read them.
      owner: string;
      repo: string;
      archiveSink: ArchiveSink | undefined;
    };

export interface ResolvePullSourceInput {
  knowledgeId: string;
  payload: GithubPullPayload;
  currentCommit: string;
  branch: string;
  repoUrl: string;
  gitToken: string | undefined;
  orgId: string;
  pullFactory: PullFactory | undefined;
}

/** The provider's source resolver (clone + diff), injected into a pull driver. */
export type PullSourceResolver = (input: ResolvePullSourceInput) => Promise<PullSourceResolution>;

/** A bound pull driver as wired by a composition root and registered on the queue. */
export type PullRunner = (
  msg: JobMessage<GithubPullPayload>,
  pullFactory?: PullFactory,
  progressContextFactory?: ProgressContextFactory,
  usageGuard?: UsageGuard,
) => Promise<PipelineSummary>;
