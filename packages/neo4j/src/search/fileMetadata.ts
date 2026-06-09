import type { FileMetadataRow } from "@bb/graph-core";
import { getKnowledgeScope } from "@bb/config";
import { _runCypher } from "#src/client.ts";

interface RawRow {
  path: string;
  language: string | null;
  sizeBytes: number | null;
  purpose: string | null;
  summary: string | null;
  businessContext: string | null;
  keywords: (string | null)[];
  classes: (string | null)[];
  functions: (string | null)[];
  importsInternal: (string | null)[];
  importsExternal: (string | null)[];
}

const FILE_METADATA_CYPHER = `
  MATCH (f:File)
  WHERE f.knowledgeId = $knowledgeId AND f.relativePath IN $paths
    AND ($scope IS NULL OR f.knowledgeId IN $scope)
  OPTIONAL MATCH (f)-[:HAS_KEYWORD]->(kw:Keyword)
  OPTIONAL MATCH (f)-[:HAS_CLASS]->(c:Class)
  OPTIONAL MATCH (f)-[:HAS_FUNCTION]->(fn:Function)
  OPTIONAL MATCH (f)-[:HAS_IMPORT_INTERNAL]->(mi:Module)
  OPTIONAL MATCH (f)-[:HAS_IMPORT_EXTERNAL]->(me:Module)
  RETURN f.relativePath AS path,
         f.language AS language,
         f.sizeBytes AS sizeBytes,
         f.purpose AS purpose,
         f.summary AS summary,
         f.businessContext AS businessContext,
         collect(DISTINCT kw.name) AS keywords,
         collect(DISTINCT c.signature) AS classes,
         collect(DISTINCT fn.signature) AS functions,
         collect(DISTINCT mi.name) AS importsInternal,
         collect(DISTINCT me.name) AS importsExternal
`;

function filterStrings(items: readonly (string | null)[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string" && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}

export async function fetchFileMetadata(knowledgeId: string, paths: readonly string[]): Promise<FileMetadataRow[]> {
  if (paths.length === 0) {
    return [];
  }
  const rows = await _runCypher<RawRow>(FILE_METADATA_CYPHER, {
    knowledgeId,
    paths: [...paths],
    scope: getKnowledgeScope(),
  });
  return rows.map((row) => ({
    path: row.path,
    language: row.language,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    purpose: row.purpose,
    summary: row.summary,
    businessContext: row.businessContext,
    keywords: filterStrings(row.keywords),
    classes: filterStrings(row.classes),
    functions: filterStrings(row.functions),
    importsInternal: filterStrings(row.importsInternal),
    importsExternal: filterStrings(row.importsExternal),
  }));
}
