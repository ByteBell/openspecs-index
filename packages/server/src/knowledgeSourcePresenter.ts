import { normalizeCommitHashes, resolveIndexedCommit, type KnowledgeSource } from "@bb/types";

export interface LegacyKnowledgeInfo {
  repoUrl?: unknown;
  branch?: unknown;
  git_url?: unknown;
  githubInfo?: { commitId?: unknown; commitHashes?: unknown; branchName?: unknown };
}

export function getLegacyInfo(entry: unknown): LegacyKnowledgeInfo | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const info = (entry as { info?: unknown }).info;
  return typeof info === "object" && info !== null ? (info as LegacyKnowledgeInfo) : undefined;
}

export function normalizeRepoSource(source: KnowledgeSource, info?: LegacyKnowledgeInfo): KnowledgeSource {
  if (source.kind !== "github") {
    return source;
  }
  const sourceRecord = source as { repoUrl?: unknown; branch?: unknown };
  const commitHashes = normalizeCommitHashes(source.commitHashes);
  const fallbackCommitHashes = normalizeCommitHashes(info?.githubInfo?.commitHashes);
  const resolvedCommitHashes = commitHashes.length > 0 ? commitHashes : fallbackCommitHashes;
  const fallbackCommitId = typeof info?.githubInfo?.commitId === "string" ? info.githubInfo.commitId : undefined;
  const commitId = resolveIndexedCommit({
    kind: "github",
    repoUrl: "",
    ...(source.commitId !== undefined
      ? { commitId: source.commitId }
      : fallbackCommitId !== undefined
        ? { commitId: fallbackCommitId }
        : {}),
    commitHashes: resolvedCommitHashes,
  });
  const repoUrl =
    typeof sourceRecord.repoUrl === "string"
      ? sourceRecord.repoUrl
      : typeof info?.repoUrl === "string"
        ? info.repoUrl
        : typeof info?.git_url === "string"
          ? info.git_url
          : "";
  const branch =
    typeof sourceRecord.branch === "string"
      ? sourceRecord.branch
      : typeof info?.branch === "string"
        ? info.branch
        : typeof info?.githubInfo?.branchName === "string"
          ? info.githubInfo.branchName
          : undefined;
  return {
    kind: "github",
    repoUrl,
    ...(branch !== undefined ? { branch } : {}),
    ...(commitId !== undefined ? { commitId } : {}),
    commitHashes: resolvedCommitHashes,
  };
}
