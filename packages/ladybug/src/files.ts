import { _runCypher } from "./client.ts";
import { ParquetSchema, ParquetWriter } from "parquetjs";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { fileParquetSchema, relParquetSchema } from "./fileSchemas.ts";
import type { UpsertFileNodeInput } from "./fileSchemas.ts";

const DELETE_FILES = `
MATCH (f:File)
WHERE f.id IN $ids
DETACH DELETE f
`;

export async function deleteFileNodes(knowledgeId: string, relativePaths: string[]): Promise<void> {
  if (relativePaths.length === 0) {
    return;
  }
  const ids = relativePaths.map((p) => `${knowledgeId}::${p}`);
  await _runCypher(DELETE_FILES, { ids });
}

export async function bulkUpsertFiles(
  knowledgeId: string,
  fileStream: AsyncIterable<UpsertFileNodeInput>,
): Promise<void> {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).substring(2, 9);
  const tempPaths: string[] = [];

  const openWriter = async (
    prefix: string,
    schema: ParquetSchema,
  ): Promise<{ writer: ParquetWriter; path: string }> => {
    const path = join(process.cwd(), `temp_${prefix}_${timestamp}_${rand}.parquet`);
    tempPaths.push(path);
    const writer = await ParquetWriter.openFile(schema, path);
    return { writer, path };
  };

  // Generate paths and open all writers upfront
  const fileWriterInfo = await openWriter("files", fileParquetSchema);
  const hasFileRelWriterInfo = await openWriter("has_file_rel", relParquetSchema);
  const containsRelWriterInfo = await openWriter("contains_rel", relParquetSchema);
  const hasKeywordRelWriterInfo = await openWriter("keyword_rel", relParquetSchema);
  const hasClassRelWriterInfo = await openWriter("class_rel", relParquetSchema);
  const hasFunctionRelWriterInfo = await openWriter("function_rel", relParquetSchema);
  const hasImportInternalRelWriterInfo = await openWriter("import_int_rel", relParquetSchema);
  const hasImportExternalRelWriterInfo = await openWriter("import_ext_rel", relParquetSchema);

  // Initialize record counters to selectively run COPY queries
  let fileCount = 0;
  let hasFileCount = 0;
  let containsCount = 0;
  let keywordCount = 0;
  let classCount = 0;
  let functionCount = 0;
  let importIntCount = 0;
  let importExtCount = 0;

  try {
    const allKeywords = new Set<string>();
    const allClasses = new Set<string>();
    const allFunctions = new Set<string>();
    const allImportsInternal = new Set<string>();
    const allImportsExternal = new Set<string>();

    for await (const input of fileStream) {
      const orgId = input.orgId ?? "local";
      const repoId = input.repoId ?? input.knowledgeId;
      const id = `${input.knowledgeId}::${input.relativePath}`;

      // Collect entities for UNWIND MERGE
      for (const kw of input.analysis.keywords) {
        allKeywords.add(kw.toLowerCase());
      }
      for (const c of input.analysis.classes) {
        allClasses.add(c);
      }
      for (const f of input.analysis.functions) {
        allFunctions.add(f);
      }
      for (const i of input.analysis.importsInternal) {
        allImportsInternal.add(i);
      }
      for (const e of input.analysis.importsExternal) {
        allImportsExternal.add(e);
      }

      // Write file node row
      const sectionMap = input.analysis.sectionMap ?? [];
      const fileRow = {
        id,
        orgId,
        knowledgeId: input.knowledgeId,
        repoId,
        relativePath: input.relativePath,
        language: input.language,
        sha: input.sha,
        sizeBytes: input.sizeBytes,
        purpose: input.analysis.purpose,
        summary: input.analysis.summary,
        businessContext: input.analysis.businessContext,
        dataFlowDirection: input.analysis.dataFlowDirection ?? "",
        ontologyConcepts: input.analysis.ontologyConcepts ?? [],
        businessEntities: input.analysis.businessEntities ?? [],
        systemCapabilities: input.analysis.systemCapabilities ?? [],
        sideEffects: input.analysis.sideEffects ?? [],
        configDependencies: input.analysis.configDependencies ?? [],
        integrationSurface: input.analysis.integrationSurface ?? [],
        contractsProvided: input.analysis.contractsProvided ?? [],
        contractsConsumed: input.analysis.contractsConsumed ?? [],
        sectionNames: sectionMap.map((s) => s.name),
        sectionDescriptions: sectionMap.map((s) => s.description),
        isBigFile: input.isBigFile ?? false,
        totalChunks: input.totalChunks ?? 0,
        totalTokenCount: input.totalTokenCount ?? 0,
        updatedAt: new Date().toISOString(),
      };
      await fileWriterInfo.writer.appendRow(fileRow);
      fileCount++;

      // HAS_FILE link row
      await hasFileRelWriterInfo.writer.appendRow({ from: input.knowledgeId, to: id });
      hasFileCount++;

      // CONTAINS link row (Folder)
      if (input.folderPath !== undefined) {
        const folderId = `${orgId}::${input.knowledgeId}::${repoId}::${input.folderPath}`;
        await containsRelWriterInfo.writer.appendRow({ from: folderId, to: id });
        containsCount++;
      }

      // HAS_KEYWORD rows
      if (input.analysis.keywords.length > 0) {
        for (const kw of input.analysis.keywords) {
          await hasKeywordRelWriterInfo.writer.appendRow({ from: id, to: kw.toLowerCase() });
          keywordCount++;
        }
      }

      // HAS_CLASS rows
      if (input.analysis.classes.length > 0) {
        for (const c of input.analysis.classes) {
          await hasClassRelWriterInfo.writer.appendRow({ from: id, to: c });
          classCount++;
        }
      }

      // HAS_FUNCTION rows
      if (input.analysis.functions.length > 0) {
        for (const f of input.analysis.functions) {
          await hasFunctionRelWriterInfo.writer.appendRow({ from: id, to: f });
          functionCount++;
        }
      }

      // HAS_IMPORT_INTERNAL rows
      if (input.analysis.importsInternal.length > 0) {
        for (const i of input.analysis.importsInternal) {
          await hasImportInternalRelWriterInfo.writer.appendRow({ from: id, to: i });
          importIntCount++;
        }
      }

      // HAS_IMPORT_EXTERNAL rows
      if (input.analysis.importsExternal.length > 0) {
        for (const e of input.analysis.importsExternal) {
          await hasImportExternalRelWriterInfo.writer.appendRow({ from: id, to: e });
          importExtCount++;
        }
      }
    }

    // Close all open writers
    await fileWriterInfo.writer.close();
    await hasFileRelWriterInfo.writer.close();
    await containsRelWriterInfo.writer.close();
    await hasKeywordRelWriterInfo.writer.close();
    await hasClassRelWriterInfo.writer.close();
    await hasFunctionRelWriterInfo.writer.close();
    await hasImportInternalRelWriterInfo.writer.close();
    await hasImportExternalRelWriterInfo.writer.close();

    // If no files were written, we are done
    if (fileCount === 0) {
      return;
    }

    // A single Cypher query to clear out old data for this knowledgeId
    // Clean slate deletion: MATCH (f:File {knowledgeId: $knowledgeId}) DETACH DELETE f
    await _runCypher(
      `MATCH (f:File {knowledgeId: $knowledgeId})
       DETACH DELETE f`,
      { knowledgeId },
    );

    // UNWIND MERGE queries for referenced nodes
    if (allKeywords.size > 0) {
      await _runCypher(
        `UNWIND $names AS name
         MERGE (kw:Keyword {name: name})`,
        { names: Array.from(allKeywords) },
      );
    }
    if (allClasses.size > 0) {
      await _runCypher(
        `UNWIND $signatures AS signature
         MERGE (c:Class {signature: signature})`,
        { signatures: Array.from(allClasses) },
      );
    }
    if (allFunctions.size > 0) {
      await _runCypher(
        `UNWIND $signatures AS signature
         MERGE (fn:Function {signature: signature})`,
        { signatures: Array.from(allFunctions) },
      );
    }
    if (allImportsInternal.size > 0) {
      await _runCypher(
        `UNWIND $names AS name
         MERGE (m:Module {name: name})`,
        { names: Array.from(allImportsInternal) },
      );
    }
    if (allImportsExternal.size > 0) {
      await _runCypher(
        `UNWIND $names AS name
         MERGE (m:Module {name: name})`,
        { names: Array.from(allImportsExternal) },
      );
    }

    // Execute COPY FROM commands exactly once
    if (fileCount > 0) {
      await _runCypher(`COPY File FROM '${fileWriterInfo.path}'`);
    }
    if (hasFileCount > 0) {
      await _runCypher(`COPY HAS_FILE FROM '${hasFileRelWriterInfo.path}'`);
    }
    if (containsCount > 0) {
      await _runCypher(`COPY CONTAINS FROM '${containsRelWriterInfo.path}' (FROM='Folder', TO='File')`);
    }
    if (keywordCount > 0) {
      await _runCypher(`COPY HAS_KEYWORD FROM '${hasKeywordRelWriterInfo.path}' (FROM='File', TO='Keyword')`);
    }
    if (classCount > 0) {
      await _runCypher(`COPY HAS_CLASS FROM '${hasClassRelWriterInfo.path}'`);
    }
    if (functionCount > 0) {
      await _runCypher(`COPY HAS_FUNCTION FROM '${hasFunctionRelWriterInfo.path}'`);
    }
    if (importIntCount > 0) {
      await _runCypher(`COPY HAS_IMPORT_INTERNAL FROM '${hasImportInternalRelWriterInfo.path}'`);
    }
    if (importExtCount > 0) {
      await _runCypher(`COPY HAS_IMPORT_EXTERNAL FROM '${hasImportExternalRelWriterInfo.path}'`);
    }
  } finally {
    for (const p of tempPaths) {
      try {
        unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }
}

export async function upsertFileNode(input: UpsertFileNodeInput): Promise<void> {
  async function* single() {
    yield input;
  }
  await bulkUpsertFiles(input.knowledgeId, single());
}
