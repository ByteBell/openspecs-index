import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { businessContextDir } from "@bb/ingest-core";
import { logger } from "@bb/logger";

const DIR_MODE = 0o700;

/**
 * Persists the raw user-authored text. Mirror copy of the input — used for
 * audit (proving what was analysed) and for re-running the analysis later
 * against an updated field-defs schema without re-prompting the user.
 */
export async function saveOriginalText(
  knowledgeId: string,
  commitHash: string,
  sanitizedTitle: string,
  text: string,
): Promise<string> {
  const dir = await businessContextDir(knowledgeId, commitHash, sanitizedTitle);
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const filePath = path.join(dir, "original.txt");
  await writeFile(filePath, text, { encoding: "utf-8", mode: 0o600 });
  logger.info(`business-context: saved original text at ${filePath} (${text.length} chars)`);
  return filePath;
}
