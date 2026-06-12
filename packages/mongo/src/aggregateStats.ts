import type { KnowledgeDoc, StatsCommitEntry, StatsRepoEntry, StatsResponse, StatsTotals } from "@bb/types";
import { _getDb } from "./client.ts";
import { Collections } from "./collections.ts";

interface CommitHashRecord {
  hash: string;
  inputTokens: string;
  outputTokens: string;
  costUsd: string;
}

/**
 * Aggregates token + cost stats over the `knowledge` collection. Replaces the
 * previous read against the deleted `processing_stats` collection — the
 * authoritative per-commit numbers now live on the knowledge document's
 * `source.commitHashes[]` (populated by `setKnowledgeCommit`).
 *
 * Fields that the old `processing_stats` row carried but the knowledge doc
 * does not (per-commit `processingTimeMs`, `totalBatches`, `totalFolders`,
 * `filesAnalyzed`, `createdAt`/`updatedAt`) are reported as 0 / empty —
 * the `bytebell stats` UI tolerates that.
 */
export async function aggregateStats(): Promise<StatsResponse> {
  const db = _getDb();
  const knowledgeDocs = (await db
    .collection(Collections.Knowledge)
    .find({})
    .sort({ updatedAt: -1 })
    .toArray()) as unknown as KnowledgeDoc[];

  const repos: StatsRepoEntry[] = [];
  const commitStats: StatsCommitEntry[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let totalFiles = 0;

  for (const doc of knowledgeDocs) {
    const commits = pickCommits(doc);
    const fileCount = await db.collection(Collections.Raw).countDocuments({ knowledgeId: doc.knowledgeId });
    const repoName = deriveRepoName(doc);
    const type = doc.source.kind === "github" ? ("GITHUB" as const) : ("LOCAL" as const);

    let repoIn = 0;
    let repoOut = 0;
    let repoCost = 0;
    for (const c of commits) {
      const inT = parseNumber(c.inputTokens);
      const outT = parseNumber(c.outputTokens);
      const cost = parseNumber(c.costUsd);
      repoIn += inT;
      repoOut += outT;
      repoCost += cost;
      commitStats.push({
        knowledgeId: doc.knowledgeId,
        repoName,
        commitHash: c.hash,
        inputTokens: inT,
        outputTokens: outT,
        estimatedCost: cost,
        totalBatches: 0,
        processingTimeMs: 0,
        totalFiles: fileCount,
        totalFolders: 0,
        filesAnalyzed: fileCount,
        createdAt: "",
        updatedAt: "",
      });
    }

    repos.push({
      knowledgeId: doc.knowledgeId,
      repoName,
      type,
      fileCount,
      folderCount: 0,
      inputTokens: repoIn,
      outputTokens: repoOut,
      estimatedCost: repoCost,
    });

    totalInputTokens += repoIn;
    totalOutputTokens += repoOut;
    totalCost += repoCost;
    totalFiles += fileCount;
  }

  const totals: StatsTotals = {
    totalRepos: knowledgeDocs.length,
    totalFiles,
    totalFolders: 0,
    totalInputTokens,
    totalOutputTokens,
    totalEstimatedCost: Math.round(totalCost * 1_000_000) / 1_000_000,
  };

  return { totals, repos, commitStats };
}

function pickCommits(doc: KnowledgeDoc): CommitHashRecord[] {
  const source = (doc as unknown as { source?: { commitHashes?: unknown } }).source;
  const raw = source?.commitHashes;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: CommitHashRecord[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const rec = entry as Partial<CommitHashRecord>;
    if (typeof rec.hash !== "string") {
      continue;
    }
    out.push({
      hash: rec.hash,
      inputTokens: typeof rec.inputTokens === "string" ? rec.inputTokens : "0",
      outputTokens: typeof rec.outputTokens === "string" ? rec.outputTokens : "0",
      costUsd: typeof rec.costUsd === "string" ? rec.costUsd : "0",
    });
  }
  return out;
}

function parseNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function deriveRepoName(doc: KnowledgeDoc): string {
  if (doc.source.kind === "local") {
    const segments = doc.source.sourcePath.split("/").filter((s) => s.length > 0);
    return segments.at(-1) ?? doc.source.sourcePath;
  }
  // `info` is typed required, but legacy / partially-written docs can lack it
  // entirely — guard against `doc.info` being undefined so stats never crash.
  const repoUrl = doc.info?.repoUrl ?? "";
  try {
    const segments = new URL(repoUrl).pathname
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const repo = segments.at(-1)?.replace(/\.git$/u, "");
    const owner = segments.at(-2);
    if (owner !== undefined && repo !== undefined) {
      return `${owner}/${repo}`;
    }
  } catch {
    // fall through
  }
  // No usable URL — render a stable, non-empty label rather than a blank cell.
  return repoUrl.length > 0 ? repoUrl : `unknown (${doc.knowledgeId.slice(0, 8)})`;
}
