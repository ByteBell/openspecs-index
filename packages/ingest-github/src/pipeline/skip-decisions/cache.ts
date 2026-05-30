import fs from "node:fs";
import path from "node:path";
import { getBytebellHome } from "@bb/config";
import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import { logger } from "@bb/logger";

const FILE_MODE = 0o600;

export interface DecisionEntry {
  ignore: boolean;
  source: "hardcoded" | "llm";
  repository_name?: string;
  files?: string[];
}

export type OversizedReason = "size-bytes" | "line-count";

export interface OversizedDecisionEntry {
  reason: OversizedReason;
  sizeBytes: number;
  repository_name?: string;
  firstSeenAt: string;
}

export interface DecisionsCache {
  directories: Record<string, DecisionEntry>;
  extensions: Record<string, DecisionEntry>;
  filenames: Record<string, DecisionEntry>;
  filename_globs: Record<string, DecisionEntry>;
  oversized_files: Record<string, OversizedDecisionEntry>;
}

export function defaultCachePath(): string {
  const configured = getConfigValue(Config.SkipDecisionCachePath);
  if (configured.length > 0) {
    return configured;
  }
  return path.join(getBytebellHome(), "llmDecisions.json");
}

export function emptyCache(): DecisionsCache {
  return { directories: {}, extensions: {}, filenames: {}, filename_globs: {}, oversized_files: {} };
}

export function loadCache(filePath: string): DecisionsCache {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return narrow(parsed);
  } catch {
    return emptyCache();
  }
}

export function saveCache(filePath: string, cache: DecisionsCache): void {
  const tmp = `${filePath}.tmp`;
  const json = `${JSON.stringify(cache, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(tmp, "w", FILE_MODE);
  try {
    fs.writeSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

export function setExtensionDecision(
  cache: DecisionsCache,
  ext: string,
  ignore: boolean,
  source: DecisionEntry["source"],
  repositoryName: string | undefined,
  relativePath: string,
): void {
  const existing = cache.extensions[ext];
  const files = existing?.files ?? [];
  if (ignore && !files.includes(relativePath)) {
    files.push(relativePath);
  }
  const entry: DecisionEntry = { ignore, source };
  if (repositoryName !== undefined) {
    entry.repository_name = repositoryName;
  }
  if (ignore) {
    entry.files = files;
  }
  cache.extensions[ext] = entry;
}

export function setOversizedDecision(
  cache: DecisionsCache,
  relativePath: string,
  sizeBytes: number,
  reason: OversizedReason,
  repositoryName: string | undefined,
): void {
  const existing = cache.oversized_files[relativePath];
  const entry: OversizedDecisionEntry = {
    reason,
    sizeBytes,
    firstSeenAt: existing?.firstSeenAt ?? new Date().toISOString(),
  };
  if (repositoryName !== undefined) {
    entry.repository_name = repositoryName;
  }
  cache.oversized_files[relativePath] = entry;
}

export function setFilenameDecision(
  cache: DecisionsCache,
  filename: string,
  ignore: boolean,
  source: DecisionEntry["source"],
  repositoryName: string | undefined,
  relativePath: string,
): void {
  const existing = cache.filenames[filename];
  const files = existing?.files ?? [];
  if (ignore && !files.includes(relativePath)) {
    files.push(relativePath);
  }
  const entry: DecisionEntry = { ignore, source };
  if (repositoryName !== undefined) {
    entry.repository_name = repositoryName;
  }
  if (ignore) {
    entry.files = files;
  }
  cache.filenames[filename] = entry;
}

function narrow(value: unknown): DecisionsCache {
  if (typeof value !== "object" || value === null) {
    return emptyCache();
  }
  const rec = value as Record<string, unknown>;
  return {
    directories: narrowSection(rec["directories"]),
    extensions: narrowSection(rec["extensions"]),
    filenames: narrowSection(rec["filenames"]),
    filename_globs: narrowSection(rec["filename_globs"]),
    oversized_files: narrowOversizedSection(rec["oversized_files"]),
  };
}

function narrowOversizedSection(value: unknown): Record<string, OversizedDecisionEntry> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const out: Record<string, OversizedDecisionEntry> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const obj = raw as Record<string, unknown>;
    const reason = obj["reason"];
    const sizeBytes = obj["sizeBytes"];
    const firstSeenAt = obj["firstSeenAt"];
    if (reason !== "size-bytes" && reason !== "line-count") {
      continue;
    }
    if (typeof sizeBytes !== "number" || typeof firstSeenAt !== "string") {
      continue;
    }
    const entry: OversizedDecisionEntry = { reason, sizeBytes, firstSeenAt };
    if (typeof obj["repository_name"] === "string") {
      entry.repository_name = obj["repository_name"];
    }
    out[key] = entry;
  }
  return out;
}

function narrowSection(value: unknown): Record<string, DecisionEntry> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const out: Record<string, DecisionEntry> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const obj = raw as Record<string, unknown>;
    const ignore = obj["ignore"];
    const source = obj["source"];
    if (typeof ignore !== "boolean") {
      continue;
    }
    const entry: DecisionEntry = {
      ignore,
      source: source === "llm" ? "llm" : "hardcoded",
    };
    if (typeof obj["repository_name"] === "string") {
      entry.repository_name = obj["repository_name"];
    }
    if (Array.isArray(obj["files"])) {
      entry.files = obj["files"].filter((f): f is string => typeof f === "string");
    }
    out[key] = entry;
  }
  return out;
}

export function logCacheSummary(cache: DecisionsCache): void {
  const dirs = Object.keys(cache.directories).length;
  const exts = Object.keys(cache.extensions).length;
  const filenames = Object.keys(cache.filenames).length;
  const globs = Object.keys(cache.filename_globs).length;
  const oversized = Object.keys(cache.oversized_files).length;
  logger.info(
    `skip-decisions cache loaded: directories=${dirs} extensions=${exts} filenames=${filenames} globs=${globs} oversized=${oversized}`,
  );
}
