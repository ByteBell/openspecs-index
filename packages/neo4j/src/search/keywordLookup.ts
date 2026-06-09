import type { KeywordLookupInput, KeywordLookupMatch, KeywordLookupRow } from "@bb/graph-core";
import { getKnowledgeScope } from "@bb/config";
import { _runCypher, toNeo4jInt } from "#src/client.ts";
import { buildFulltextQuery, escapeLucene } from "#src/search/lucene.ts";

interface RawRow {
  name: string | null;
  path: string | null;
  purpose: string | null;
  summary: string | null;
  repoName: string | null;
  knowledgeId: string | null;
}

const KEYWORD_CYPHER = `
  CALL db.index.fulltext.queryNodes('idx_keyword_name_ft', $fulltextQuery) YIELD node AS kw, score
  WITH kw, score ORDER BY score DESC LIMIT $keywordLimit
  MATCH (f:File)-[:HAS_KEYWORD]->(kw)
  WHERE ($knowledgeId IS NULL OR f.knowledgeId = $knowledgeId)
    AND ($knowledgeIds IS NULL OR f.knowledgeId IN $knowledgeIds)
    AND ($scope IS NULL OR f.knowledgeId IN $scope)
  MATCH (k:Knowledge {knowledgeId: f.knowledgeId})
  WITH kw, f, k LIMIT $keywordLimit * $filesPerKeyword
  RETURN kw.name AS name,
         f.relativePath AS path,
         f.purpose AS purpose,
         f.summary AS summary,
         k.repoName AS repoName,
         f.knowledgeId AS knowledgeId
`;

const MODULE_CYPHER = `
  MATCH (m:Module) WHERE toLower(m.name) CONTAINS $term
  WITH m ORDER BY m.name LIMIT $keywordLimit
  MATCH (f:File)-[:HAS_IMPORT_INTERNAL|HAS_IMPORT_EXTERNAL]->(m)
  WHERE ($knowledgeId IS NULL OR f.knowledgeId = $knowledgeId)
    AND ($knowledgeIds IS NULL OR f.knowledgeId IN $knowledgeIds)
    AND ($scope IS NULL OR f.knowledgeId IN $scope)
  MATCH (k:Knowledge {knowledgeId: f.knowledgeId})
  WITH m, f, k LIMIT $keywordLimit * $filesPerKeyword
  RETURN m.name AS name,
         f.relativePath AS path,
         f.purpose AS purpose,
         f.summary AS summary,
         k.repoName AS repoName,
         f.knowledgeId AS knowledgeId
`;

function symbolCypher(label: "Class" | "Function", rel: "HAS_CLASS" | "HAS_FUNCTION"): string {
  return `
    CALL db.index.fulltext.queryNodes('idx_symbol_signature_ft', $fulltextQuery) YIELD node AS sym, score
    WHERE '${label}' IN labels(sym)
    WITH sym, score ORDER BY score DESC LIMIT $keywordLimit
    MATCH (f:File)-[:${rel}]->(sym)
    WHERE ($knowledgeId IS NULL OR f.knowledgeId = $knowledgeId)
      AND ($knowledgeIds IS NULL OR f.knowledgeId IN $knowledgeIds)
      AND ($scope IS NULL OR f.knowledgeId IN $scope)
    MATCH (k:Knowledge {knowledgeId: f.knowledgeId})
    WITH sym, f, k LIMIT $keywordLimit * $filesPerKeyword
    RETURN sym.signature AS name,
           f.relativePath AS path,
           f.purpose AS purpose,
           f.summary AS summary,
           k.repoName AS repoName,
           f.knowledgeId AS knowledgeId
  `;
}

function cypherForMatch(match: KeywordLookupMatch): string {
  if (match === "keyword") {
    return KEYWORD_CYPHER;
  }
  if (match === "module") {
    return MODULE_CYPHER;
  }
  if (match === "class") {
    return symbolCypher("Class", "HAS_CLASS");
  }
  return symbolCypher("Function", "HAS_FUNCTION");
}

export async function keywordLookup(input: KeywordLookupInput): Promise<KeywordLookupRow[]> {
  const lower = input.term.toLowerCase();
  const params: Record<string, unknown> = {
    knowledgeId: input.knowledgeId,
    knowledgeIds: input.knowledgeIds === null ? null : [...input.knowledgeIds],
    scope: getKnowledgeScope(),
    keywordLimit: toNeo4jInt(input.keywordLimit),
    filesPerKeyword: toNeo4jInt(input.filesPerKeyword),
  };
  if (input.match === "module") {
    params["term"] = lower;
  } else {
    params["fulltextQuery"] = buildFulltextQuery([escapeLucene(lower)]);
  }
  const rows = await _runCypher<RawRow>(cypherForMatch(input.match), params);
  return rows.map((row) => ({
    name: row.name ?? "",
    path: row.path,
    purpose: row.purpose,
    summary: row.summary,
    repoName: row.repoName,
    knowledgeId: row.knowledgeId,
  }));
}
