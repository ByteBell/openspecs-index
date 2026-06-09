import type { KnowledgeListRow } from "@bb/graph-core";
import { getKnowledgeScope } from "@bb/config";
import { _runCypher } from "#src/client.ts";

interface RawRow {
  knowledgeId: string | null;
  repoName: string | null;
  sourceKind: string | null;
  sourceUrl: string | null;
  branch: string | null;
  state: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  fileCount: number | { toNumber: () => number } | null;
}

const LIST_KNOWLEDGE_CYPHER = `
  MATCH (k:Knowledge)
  WHERE ($scope IS NULL OR k.knowledgeId IN $scope)
  OPTIONAL MATCH (k)-[:HAS_FILE]->(f:File)
  WITH k, count(f) AS fileCount
  RETURN k.knowledgeId AS knowledgeId,
         k.repoName    AS repoName,
         k.sourceKind  AS sourceKind,
         k.sourceUrl   AS sourceUrl,
         k.branch      AS branch,
         k.state       AS state,
         k.createdAt   AS createdAt,
         k.updatedAt   AS updatedAt,
         fileCount
  ORDER BY k.updatedAt DESC
`;

function toNumber(value: RawRow["fileCount"]): number {
  if (value === null) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  return value.toNumber();
}

export async function listKnowledgeBases(): Promise<KnowledgeListRow[]> {
  const raw = await _runCypher<RawRow>(LIST_KNOWLEDGE_CYPHER, { scope: getKnowledgeScope() });
  return raw.map((row) => ({
    knowledgeId: row.knowledgeId ?? "",
    repoName: row.repoName ?? "",
    sourceKind: row.sourceKind ?? "",
    sourceUrl: row.sourceUrl ?? "",
    branch: row.branch,
    state: row.state ?? "",
    createdAt: row.createdAt ?? "",
    updatedAt: row.updatedAt ?? "",
    fileCount: toNumber(row.fileCount),
  }));
}
