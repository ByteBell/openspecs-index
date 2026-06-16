import type { GithubIndexPayload } from "@bb/types";
import type { ArchiveSink, SourceFactory, SourceReader } from "#src/types/pipeline.ts";
import type { RepoLocation } from "#src/pipeline/paths.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Provider-agnostic INDEX seam (the index-side counterpart of PullSourceResolver).
//
// An index router (the OSS github runner for public strategies, or a private
// out-of-tree router in a downstream package) is given an `IndexSourceResolver`
// by the composition root. The resolver is the provider's job: resolve the
// branch + repo coordinates, clone (or stream via the source factory), and
// return a provider-neutral `IndexSourceResolution`. The router then runs the
// strategy over `source` without importing a provider.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolveIndexSourceInput {
  knowledgeId: string;
  payload: GithubIndexPayload;
  orgId: string;
  /** When provided, the resolver uses the factory's reader instead of cloning. */
  sourceFactory: SourceFactory | undefined;
}

export interface IndexSourceResolution {
  source: SourceReader;
  archiveSink: ArchiveSink | undefined;
  commitHash: string;
  branch: string;
  location: RepoLocation;
  owner: string;
  repo: string;
}

/** The provider's index source resolver (branch + clone/stream), injected into a router. */
export type IndexSourceResolver = (input: ResolveIndexSourceInput) => Promise<IndexSourceResolution>;
