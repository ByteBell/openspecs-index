import { askJsonLLM, type AskLlmOptions } from "@bb/llm";
import { LlmConfigError, LlmError } from "@bb/errors";
import { logger } from "@bb/logger";
import type { FileAnalysis, FileAnalysisSection } from "@bb/db-core";
import { FALLBACK_LANGUAGE, emptyFileAnalysis } from "#src/types/file-analysis.ts";
import type { AnalyzedFileResult, FileAnalyzer } from "#src/types/pipeline.ts";

export interface LlmFileAnalyzerDeps {
  buildSystemPrompt: () => string;
  buildUserPrompt: (input: { relativePath: string; content: string }) => string;
}

interface RawAnalysisJson {
  language?: unknown;
  purpose?: unknown;
  summary?: unknown;
  businessContext?: unknown;
  classes?: unknown;
  functions?: unknown;
  importsInternal?: unknown;
  importsExternal?: unknown;
  keywords?: unknown;
  ontologyConcepts?: unknown;
  businessEntities?: unknown;
  systemCapabilities?: unknown;
  sideEffects?: unknown;
  configDependencies?: unknown;
  dataFlowDirection?: unknown;
  integrationSurface?: unknown;
  contractsProvided?: unknown;
  contractsConsumed?: unknown;
  sectionMap?: unknown;
}

export function createLlmFileAnalyzer(deps: LlmFileAnalyzerDeps): FileAnalyzer {
  return {
    async analyze(input: {
      relativePath: string;
      content: string;
      llmCallContext?: AskLlmOptions;
    }): Promise<AnalyzedFileResult> {
      const systemPrompt = deps.buildSystemPrompt();
      const userPrompt = deps.buildUserPrompt(input);
      const t0 = performance.now();
      let raw: RawAnalysisJson | null = null;
      let usage: { inputTokens: number; outputTokens: number; costUsd: number } | undefined;
      try {
        const response = await askJsonLLM<RawAnalysisJson>(systemPrompt, userPrompt, input.llmCallContext ?? {});
        raw = response.result;
        usage = {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.usage.costUsd,
        };
        if (raw === null) {
          logger.warn(`llm-file-analyzer: ${input.relativePath} returned unparseable JSON`);
        }
      } catch (cause: unknown) {
        if (cause instanceof LlmConfigError || cause instanceof LlmError) {
          // LLM is unreachable / misconfigured — bubble up so the runner can
          // mark the knowledge FAILED with a structured reason.
          throw cause;
        }
        const msg = cause instanceof Error ? cause.message : String(cause);
        logger.warn(`llm-file-analyzer: ${input.relativePath} askJsonLLM failed: ${msg}`);
      }
      if (raw === null) {
        return { language: FALLBACK_LANGUAGE, analysis: emptyFileAnalysis(), tokenUsage: usage };
      }
      const shaped = shapeAnalysis(raw);
      shaped.tokenUsage = usage;
      logger.info(
        `llm-file-analyzer: ✓ ${input.relativePath} (${Math.round(performance.now() - t0)}ms, lang=${shaped.language})`,
      );
      return shaped;
    },
  };
}

export function shapeAnalysis(raw: RawAnalysisJson): AnalyzedFileResult {
  const language = pickString(raw.language, FALLBACK_LANGUAGE);
  const analysis: FileAnalysis = {
    purpose: pickString(raw.purpose, ""),
    summary: pickString(raw.summary, ""),
    businessContext: pickString(raw.businessContext, ""),
    classes: pickStringArray(raw.classes),
    functions: pickStringArray(raw.functions),
    importsInternal: pickStringArray(raw.importsInternal),
    importsExternal: pickStringArray(raw.importsExternal),
    keywords: pickStringArray(raw.keywords),
  };
  attachOptional(analysis, "ontologyConcepts", pickStringArray(raw.ontologyConcepts));
  attachOptional(analysis, "businessEntities", pickStringArray(raw.businessEntities));
  attachOptional(analysis, "systemCapabilities", pickStringArray(raw.systemCapabilities));
  attachOptional(analysis, "sideEffects", pickStringArray(raw.sideEffects));
  attachOptional(analysis, "configDependencies", pickStringArray(raw.configDependencies));
  attachOptional(analysis, "integrationSurface", pickStringArray(raw.integrationSurface));
  attachOptional(analysis, "contractsProvided", pickStringArray(raw.contractsProvided));
  attachOptional(analysis, "contractsConsumed", pickStringArray(raw.contractsConsumed));
  const dataFlow = pickString(raw.dataFlowDirection, "");
  if (dataFlow.length > 0) {
    analysis.dataFlowDirection = dataFlow;
  }
  const sections = pickSections(raw.sectionMap);
  if (sections.length > 0) {
    analysis.sectionMap = sections;
  }
  return { language, analysis };
}

function pickString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return fallback;
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}

function pickSections(value: unknown): FileAnalysisSection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: FileAnalysisSection[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const name = pickString(rec["name"], "");
    const description = pickString(rec["description"], "");
    if (name.length === 0 && description.length === 0) {
      continue;
    }
    const section: FileAnalysisSection = { name, description };
    const startLine = pickPositiveInt(rec["start_line"] ?? rec["startLine"]);
    if (startLine !== undefined) {
      section.start_line = startLine;
    }
    const endLine = pickPositiveInt(rec["end_line"] ?? rec["endLine"]);
    if (endLine !== undefined) {
      section.end_line = endLine;
    }
    out.push(section);
  }
  return out;
}

function pickPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

function attachOptional(analysis: FileAnalysis, key: keyof FileAnalysis, value: string[]): void {
  if (value.length > 0) {
    (analysis as unknown as Record<string, unknown>)[key] = value;
  }
}

export function languageFromPath(relativePath: string): string {
  const ext = relativePath.slice(relativePath.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "rb":
      return "ruby";
    case "md":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "json":
      return "json";
    case "toml":
      return "toml";
    case "sh":
      return "shell";
    default:
      return FALLBACK_LANGUAGE;
  }
}
