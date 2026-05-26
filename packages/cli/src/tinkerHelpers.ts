import { Config } from "@bb/types";
import { getConfigValue } from "@bb/config";
import type { MenuItem } from "./TinkerMenu.tsx";

interface CommandEntry {
  label: string;
  detail: string;
}

const COMMANDS: CommandEntry[] = [
  { label: "boot", detail: "Bring up Docker infra + start server" },
  { label: "shutdown", detail: "Stop the bytebell-server" },
  { label: "server", detail: "Start server in foreground" },
  { label: "index <url>", detail: "Index a GitHub repo" },
  { label: "ingest [path]", detail: "Ingest a local directory" },
  { label: "pull", detail: "Pull latest for indexed repos" },
  { label: "ls", detail: "List indexed knowledge" },
  { label: "delete", detail: "Delete indexed knowledge" },
  { label: "stats", detail: "Show token/cost stats" },
  { label: "mcp", detail: "Show MCP usage & endpoint" },
  { label: "set", detail: "Open setup form" },
];

export function buildMenuItems(): MenuItem[] {
  const items: MenuItem[] = [];

  items.push({ kind: "section", label: "Commands" });
  for (const cmd of COMMANDS) {
    items.push({ kind: "command", label: cmd.label, detail: cmd.detail });
  }

  items.push({ kind: "section", label: "AI Configuration" });
  const provider = readSafe(Config.LlmProvider, "openrouter");
  items.push({ kind: "config", label: "LLM Provider", detail: provider, cliKey: "llm-provider" });
  items.push({
    kind: "config",
    label: "OpenRouter API Key",
    detail: redact(readSafe(Config.OpenrouterApiKey, "")),
    cliKey: "openrouter-api-key",
    mask: true,
  });
  items.push({
    kind: "config",
    label: "OpenRouter Model",
    detail: readSafe(Config.OpenrouterModel, ""),
    cliKey: "openrouter-model",
  });
  items.push({
    kind: "config",
    label: "Ollama Base URL",
    detail: readSafe(Config.OllamaBaseUrl, "http://localhost:11434/v1"),
    cliKey: "ollama-base-url",
  });
  items.push({
    kind: "config",
    label: "Ollama Model",
    detail: readSafe(Config.OllamaModel, "llama3.1"),
    cliKey: "ollama-model",
  });

  items.push({ kind: "section", label: "" });
  items.push({ kind: "action", label: "Save and Continue", action: "save" });
  items.push({ kind: "action", label: "Leave", action: "leave" });

  return items;
}

export function readSafe(key: Config, fallback: string): string {
  try {
    const v = getConfigValue(key);
    return typeof v === "string" ? v : String(v);
  } catch {
    return fallback;
  }
}

export function redact(val: string): string {
  if (val.length === 0) {
    return "(not set)";
  }
  return `${val.slice(0, 6)}${"*".repeat(Math.max(0, val.length - 6))}`;
}

export function firstNavigable(items: MenuItem[]): number {
  for (let i = 0; i < items.length; i++) {
    if (items[i]?.kind !== "section") {
      return i;
    }
  }
  return 0;
}
