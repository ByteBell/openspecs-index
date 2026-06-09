// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import type { KeywordLookupInput, KeywordLookupRow } from "@bb/graph-core";

import { _runCypher } from "#src/client.ts";

interface KeywordRawRow {
  name: string | null;
  path: string | null;
  purpose: string | null;
  summary: string | null;
  repoName: string | null;
  knowledgeId: string | null;
}

export async function keywordLookup(input: KeywordLookupInput): Promise<KeywordLookupRow[]> {
  const lower = input.term.toLowerCase();
  const keywordLimit = Number(input.keywordLimit);
  const filesPerKeyword = Number(input.filesPerKeyword);
  const totalLimit = keywordLimit * filesPerKeyword;

  const params: Record<string, string | number | string[] | null> = {
    knowledgeId: input.knowledgeId,
    keywordLimit,
    totalLimit,
    term: lower,
  };

  // Scope by single knowledgeId and/or the knowledgeIds allowlist, mirroring the
  // neo4j provider. The allowlist is the default scope for ConceptGraphStrategy
  // enrichment; omitting it would make those lookups run unscoped across repos.
  const scopeClauses: string[] = [];
  if (input.knowledgeId) {
    scopeClauses.push("AND f.knowledgeId = $knowledgeId");
  }
  if (input.knowledgeIds && input.knowledgeIds.length > 0) {
    scopeClauses.push("AND f.knowledgeId IN $knowledgeIds");
    params["knowledgeIds"] = [...input.knowledgeIds];
  }
  const knowledgeFilter = scopeClauses.join(" ");
  let cypher: string;

  if (input.match === "keyword") {
    cypher = `
      MATCH (kw:Keyword) WHERE toLower(kw.name) CONTAINS $term
      WITH kw ORDER BY kw.name LIMIT $keywordLimit
      MATCH (f:File)-[:HAS_KEYWORD]->(kw:Keyword) WHERE 1=1 ${knowledgeFilter}
      MATCH (k:Knowledge {knowledgeId: f.knowledgeId})
      WITH kw, f, k LIMIT $totalLimit
      RETURN kw.name AS name, f.relativePath AS path, f.purpose AS purpose, f.summary AS summary, k.repoName AS repoName, f.knowledgeId AS knowledgeId
    `;
  } else if (input.match === "module") {
    cypher = `
      MATCH (m:Module) WHERE toLower(m.name) CONTAINS $term
      WITH m ORDER BY m.name LIMIT $keywordLimit
      MATCH (f:File)-[:HAS_IMPORT_INTERNAL|HAS_IMPORT_EXTERNAL]->(m:Module) WHERE 1=1 ${knowledgeFilter}
      MATCH (k:Knowledge {knowledgeId: f.knowledgeId})
      WITH m, f, k LIMIT $totalLimit
      RETURN m.name AS name, f.relativePath AS path, f.purpose AS purpose, f.summary AS summary, k.repoName AS repoName, f.knowledgeId AS knowledgeId
    `;
  } else {
    const label = input.match === "class" ? "Class" : "Function";
    const rel = input.match === "class" ? "HAS_CLASS" : "HAS_FUNCTION";
    cypher = `
      MATCH (sym:${label}) WHERE toLower(sym.signature) CONTAINS $term
      WITH sym ORDER BY sym.signature LIMIT $keywordLimit
      MATCH (f:File)-[:${rel}]->(sym:${label}) WHERE 1=1 ${knowledgeFilter}
      MATCH (k:Knowledge {knowledgeId: f.knowledgeId})
      WITH sym, f, k LIMIT $totalLimit
      RETURN sym.signature AS name, f.relativePath AS path, f.purpose AS purpose, f.summary AS summary, k.repoName AS repoName, f.knowledgeId AS knowledgeId
    `;
  }

  const rows = await _runCypher<KeywordRawRow>(cypher, params);
  return rows.map((row) => ({
    name: row.name ?? "",
    path: row.path,
    purpose: row.purpose,
    summary: row.summary,
    repoName: row.repoName,
    knowledgeId: row.knowledgeId,
  }));
}
