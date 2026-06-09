import type { ScoredHit, SmartSearchChannel, SmartSearchChannelInput } from "@bb/graph-core";
import { getKnowledgeScope } from "@bb/config";
import { _runCypher, toNeo4jInt } from "#src/client.ts";
import { buildFulltextQuery } from "#src/search/lucene.ts";

interface RowShape {
  path: string;
  knowledgeId: string;
  score: number;
}

interface CypherParams extends Record<string, unknown> {
  knowledgeId: string | null;
  /**
   * Allowlist of knowledge IDs to constrain results to. When set, intersects
   * with `knowledgeId` if that's also set. When both are null, the search is
   * unscoped (cross-repo). Used by ConceptGraphStrategy enrichment to query
   * its own in-flight knowledge plus any cross-repo neighbours.
   */
  knowledgeIds: string[] | null;
  /** Host-injected hard scope (library mode). Null when unrestricted. */
  scope: string[] | null;
  pathPrefix: string | null;
  queryTerms: string[];
  fulltextQuery: string;
  resultCap: unknown;
  excludeSuffixes: string[];
  excludeContains: string[];
}

const EXCLUSION_WHERE = `
  AND NOT ANY(suffix IN $excludeSuffixes WHERE f.relativePath ENDS WITH suffix)
  AND NOT ANY(fragment IN $excludeContains WHERE f.relativePath CONTAINS fragment)
`;

const SHARED_FILE_FILTERS = `
  ($knowledgeId IS NULL OR f.knowledgeId = $knowledgeId)
  AND ($knowledgeIds IS NULL OR f.knowledgeId IN $knowledgeIds)
  AND ($scope IS NULL OR f.knowledgeId IN $scope)
  AND ($pathPrefix IS NULL OR f.relativePath STARTS WITH $pathPrefix)
${EXCLUSION_WHERE}`;

const COLLECT_RETURN = `
RETURN f.relativePath AS path, f.knowledgeId AS knowledgeId, score
`;

function toCypherParams(input: SmartSearchChannelInput): CypherParams {
  return {
    knowledgeId: input.knowledgeId,
    knowledgeIds: input.knowledgeIds === null ? null : [...input.knowledgeIds],
    scope: getKnowledgeScope(),
    pathPrefix: input.pathPrefix,
    queryTerms: [...input.queryTerms],
    fulltextQuery: buildFulltextQuery(input.queryTerms),
    resultCap: toNeo4jInt(input.resultCap),
    excludeSuffixes: [...input.excludeSuffixes],
    excludeContains: [...input.excludeContains],
  };
}

function toScoredHits(rows: RowShape[]): ScoredHit[] {
  return rows.map((row) => ({
    path: row.path,
    knowledgeId: row.knowledgeId,
    score: Number(row.score) || 0,
  }));
}

async function chPurpose(params: CypherParams): Promise<RowShape[]> {
  return _runCypher<RowShape>(
    `
    CALL db.index.fulltext.queryNodes('idx_file_purpose_summary_ft', $fulltextQuery)
    YIELD node AS f, score
    WHERE ${SHARED_FILE_FILTERS}
    WITH f, score ORDER BY score DESC LIMIT $resultCap
    ${COLLECT_RETURN}
  `,
    params,
  );
}

async function chBusinessContext(params: CypherParams): Promise<RowShape[]> {
  return _runCypher<RowShape>(
    `
    CALL db.index.fulltext.queryNodes('idx_file_business_context_ft', $fulltextQuery)
    YIELD node AS f, score
    WHERE ${SHARED_FILE_FILTERS}
    WITH f, score ORDER BY score DESC LIMIT $resultCap
    ${COLLECT_RETURN}
  `,
    params,
  );
}

async function chPaths(params: CypherParams): Promise<RowShape[]> {
  const isSingle = params.queryTerms.length === 1;
  const cypher = isSingle
    ? `
      MATCH (f:File)
      WHERE ${SHARED_FILE_FILTERS}
        AND toLower(f.relativePath) CONTAINS $queryTerms[0]
      WITH f, 1.0 AS score
      ORDER BY f.relativePath LIMIT $resultCap
      ${COLLECT_RETURN}
    `
    : `
      MATCH (f:File)
      WHERE ${SHARED_FILE_FILTERS}
        AND ANY(term IN $queryTerms WHERE toLower(f.relativePath) CONTAINS term)
      WITH f,
           toFloat(SIZE([term IN $queryTerms WHERE toLower(f.relativePath) CONTAINS term])) /
             toFloat(SIZE($queryTerms)) AS score
      ORDER BY score DESC, f.relativePath LIMIT $resultCap
      ${COLLECT_RETURN}
    `;
  return _runCypher<RowShape>(cypher, params);
}

async function chKeywords(params: CypherParams): Promise<RowShape[]> {
  return _runCypher<RowShape>(
    `
    CALL db.index.fulltext.queryNodes('idx_keyword_name_ft', $fulltextQuery)
    YIELD node AS kw, score
    MATCH (f:File)-[:HAS_KEYWORD]->(kw)
    WHERE ${SHARED_FILE_FILTERS}
    WITH DISTINCT f, max(score) AS score
    ORDER BY score DESC LIMIT $resultCap
    ${COLLECT_RETURN}
  `,
    params,
  );
}

async function symbolChannel(
  params: CypherParams,
  label: "Class" | "Function",
  rel: "HAS_CLASS" | "HAS_FUNCTION",
): Promise<RowShape[]> {
  return _runCypher<RowShape>(
    `
    CALL db.index.fulltext.queryNodes('idx_symbol_signature_ft', $fulltextQuery)
    YIELD node AS sym, score
    WHERE '${label}' IN labels(sym)
    MATCH (f:File)-[:${rel}]->(sym)
    WHERE ${SHARED_FILE_FILTERS}
    WITH DISTINCT f, max(score) AS score
    ORDER BY score DESC LIMIT $resultCap
    ${COLLECT_RETURN}
  `,
    params,
  );
}

async function importsChannel(
  params: CypherParams,
  rel: "HAS_IMPORT_INTERNAL" | "HAS_IMPORT_EXTERNAL",
): Promise<RowShape[]> {
  return _runCypher<RowShape>(
    `
    MATCH (m:Module)
    WHERE ANY(term IN $queryTerms WHERE toLower(m.name) CONTAINS term)
    MATCH (f:File)-[:${rel}]->(m)
    WHERE ${SHARED_FILE_FILTERS}
    WITH DISTINCT f, 1.0 AS score
    ORDER BY f.relativePath LIMIT $resultCap
    ${COLLECT_RETURN}
  `,
    params,
  );
}

export async function runSmartSearchChannel(
  channel: SmartSearchChannel,
  input: SmartSearchChannelInput,
): Promise<ScoredHit[]> {
  const params = toCypherParams(input);
  switch (channel) {
    case "purpose":
      return toScoredHits(await chPurpose(params));
    case "businessContext":
      return toScoredHits(await chBusinessContext(params));
    case "paths":
      return toScoredHits(await chPaths(params));
    case "keywords":
      return toScoredHits(await chKeywords(params));
    case "classes":
      return toScoredHits(await symbolChannel(params, "Class", "HAS_CLASS"));
    case "functions":
      return toScoredHits(await symbolChannel(params, "Function", "HAS_FUNCTION"));
    case "importsInternal":
      return toScoredHits(await importsChannel(params, "HAS_IMPORT_INTERNAL"));
    case "importsExternal":
      return toScoredHits(await importsChannel(params, "HAS_IMPORT_EXTERNAL"));
  }
}
