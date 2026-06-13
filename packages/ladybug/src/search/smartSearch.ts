// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import type { ScoredHit, SmartSearchChannel, SmartSearchChannelInput } from "@bb/graph-core";

import { _runCypher } from "#src/client.ts";
import { buildScoringMath, buildSharedFilters, buildTermMatcher } from "./cypherBuilders.ts";

interface SmartSearchRowShape {
  path: string;
  knowledgeId: string;
  score: number;
}

export async function runSmartSearchChannel(
  channel: SmartSearchChannel,
  input: SmartSearchChannelInput,
): Promise<ScoredHit[]> {
  const termCount = input.queryTerms.length;
  if (termCount === 0) {
    return [];
  }

  const params: Record<string, string | number | string[] | null> = {
    knowledgeId: input.knowledgeId,
    pathPrefix: input.pathPrefix,
    resultCap: Number(input.resultCap),
  };

  // Bind $knowledgeIds only when buildSharedFilters emits the matching
  // condition, so the prepared query's placeholders and the param map stay in
  // lockstep (an unreferenced param would be rejected by the engine).
  if (input.knowledgeIds && input.knowledgeIds.length > 0) {
    params["knowledgeIds"] = [...input.knowledgeIds];
  }

  input.queryTerms.forEach((t, i) => {
    params[`queryTerm_${i}`] = t.toLowerCase();
  });
  input.excludeSuffixes.forEach((s, i) => {
    params[`excludeSuffix_${i}`] = s.toLowerCase();
  });
  input.excludeContains.forEach((c, i) => {
    params[`excludeContains_${i}`] = c.toLowerCase();
  });

  const filters = buildSharedFilters(input, "f");
  const COLLECT_RETURN = `RETURN f.relativePath AS path, f.knowledgeId AS knowledgeId, score`;
  let rows: SmartSearchRowShape[] = [];

  switch (channel) {
    case "purpose": {
      const matchers = buildTermMatcher(["f.purpose", "f.summary"], termCount);
      const scoreMath = buildScoringMath(["f.purpose", "f.summary"], termCount);
      rows = await _runCypher<SmartSearchRowShape>(
        `MATCH (f:File) WHERE ${filters} AND ${matchers} WITH f, ${scoreMath} AS score ORDER BY score DESC LIMIT $resultCap ${COLLECT_RETURN}`,
        params,
      );
      break;
    }
    case "businessContext": {
      const matchers = buildTermMatcher(["f.businessContext"], termCount);
      const scoreMath = buildScoringMath(["f.businessContext"], termCount);
      rows = await _runCypher<SmartSearchRowShape>(
        `MATCH (f:File) WHERE ${filters} AND ${matchers} WITH f, ${scoreMath} AS score ORDER BY score DESC LIMIT $resultCap ${COLLECT_RETURN}`,
        params,
      );
      break;
    }
    case "paths": {
      const matchers = buildTermMatcher(["f.relativePath"], termCount);
      const scoreMath = buildScoringMath(["f.relativePath"], termCount);
      rows = await _runCypher<SmartSearchRowShape>(
        `MATCH (f:File) WHERE ${filters} AND ${matchers} WITH f, ${scoreMath} AS score ORDER BY score DESC, f.relativePath LIMIT $resultCap ${COLLECT_RETURN}`,
        params,
      );
      break;
    }
    case "keywords": {
      const matchers = buildTermMatcher(["kw.name"], termCount);
      const scoreMath = buildScoringMath(["kw.name"], termCount);
      rows = await _runCypher<SmartSearchRowShape>(
        `MATCH (kw:Keyword) WHERE ${matchers} MATCH (f:File)-[:HAS_KEYWORD]->(kw:Keyword) WHERE ${filters} WITH f, ${scoreMath} AS score WITH DISTINCT f, max(score) AS score ORDER BY score DESC LIMIT $resultCap ${COLLECT_RETURN}`,
        params,
      );
      break;
    }
    case "classes":
    case "functions": {
      const label = channel === "classes" ? "Class" : "Function";
      const rel = channel === "classes" ? "HAS_CLASS" : "HAS_FUNCTION";
      const matchers = buildTermMatcher(["sym.signature"], termCount);
      const scoreMath = buildScoringMath(["sym.signature"], termCount);
      rows = await _runCypher<SmartSearchRowShape>(
        `MATCH (sym:${label}) WHERE ${matchers} MATCH (f:File)-[:${rel}]->(sym:${label}) WHERE ${filters} WITH f, ${scoreMath} AS score WITH DISTINCT f, max(score) AS score ORDER BY score DESC LIMIT $resultCap ${COLLECT_RETURN}`,
        params,
      );
      break;
    }
    case "importsInternal":
    case "importsExternal": {
      const rel = channel === "importsInternal" ? "HAS_IMPORT_INTERNAL" : "HAS_IMPORT_EXTERNAL";
      const matchers = buildTermMatcher(["m.name"], termCount);
      rows = await _runCypher<SmartSearchRowShape>(
        `MATCH (m:Module) WHERE ${matchers} MATCH (f:File)-[:${rel}]->(m:Module) WHERE ${filters} WITH DISTINCT f, 1.0 AS score ORDER BY f.relativePath LIMIT $resultCap ${COLLECT_RETURN}`,
        params,
      );
      break;
    }
  }

  return rows.map((row) => ({
    path: row.path,
    knowledgeId: row.knowledgeId,
    score: Number(row.score) || 0,
  }));
}
