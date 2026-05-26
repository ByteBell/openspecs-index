import { useState, useCallback } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Config } from "@bb/types";
import { getConfigValue, LLM_PROVIDERS, type LlmProvider } from "@bb/config";
import { KEY_MAP } from "./keyMap.ts";
import { ItemRow } from "./TinkerRow.tsx";

export type MenuItemKind = "section" | "command" | "config" | "action";

export interface MenuItem {
  kind: MenuItemKind;
  label: string;
  detail?: string;
  cliKey?: string;
  mask?: boolean;
  action?: "save" | "leave";
}

export type Phase = "browse" | "edit" | "provider-pick";

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

function buildMenuItems(): MenuItem[] {
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

function readSafe(key: Config, fallback: string): string {
  try {
    const v = getConfigValue(key);
    return typeof v === "string" ? v : String(v);
  } catch {
    return fallback;
  }
}

function redact(val: string): string {
  if (val.length === 0) {
    return "(not set)";
  }
  return `${val.slice(0, 6)}${"*".repeat(Math.max(0, val.length - 6))}`;
}

function firstNavigable(items: MenuItem[]): number {
  for (let i = 0; i < items.length; i++) {
    if (items[i]?.kind !== "section") {
      return i;
    }
  }
  return 0;
}

export interface TinkerMenuProps {
  onDone: (result: { saved: boolean; command?: string }) => void;
}

export function TinkerMenu({ onDone }: TinkerMenuProps): ReactElement {
  const { exit } = useApp();
  const [items] = useState<MenuItem[]>(() => buildMenuItems());
  const [cursor, setCursor] = useState(() => firstNavigable(items));
  const [phase, setPhase] = useState<Phase>("browse");
  const [editValue, setEditValue] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [providerPick, setProviderPick] = useState(0);

  const navigableIndices = useCallback(() => {
    const result: number[] = [];
    items.forEach((item, i) => {
      if (item.kind !== "section") {
        result.push(i);
      }
    });
    return result;
  }, [items]);

  const moveCursor = useCallback(
    (dir: number) => {
      const nav = navigableIndices();
      const curIdx = nav.indexOf(cursor);
      const nextIdx = curIdx === -1 ? 0 : (curIdx + dir + nav.length) % nav.length;
      setCursor(nav[nextIdx] ?? 0);
    },
    [cursor, navigableIndices],
  );

  const handleSave = useCallback(() => {
    try {
      for (const [cliKey, value] of Object.entries(dirty)) {
        const entry = KEY_MAP[cliKey];
        if (entry !== undefined) {
          entry.setter(value);
        }
      }
      setDirty({});
      setSavedMsg("Configuration saved!");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch (cause: unknown) {
      setSavedMsg(`Save failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [dirty]);

  useInput((input, key) => {
    if (phase === "browse") {
      if (key.upArrow || input === "k") {
        moveCursor(-1);
        return;
      }
      if (key.downArrow || input === "j") {
        moveCursor(1);
        return;
      }
      if (key.escape) {
        exit();
        onDone({ saved: false, command: undefined });
        return;
      }
      if (key.return) {
        const item = items[cursor];
        if (item === undefined) {
          return;
        }
        if (item.kind === "command") {
          if (Object.keys(dirty).length > 0) {
            handleSave();
          }
          exit();
          onDone({ saved: false, command: item.label.split(" ")[0] });
          return;
        }
        if (item.kind === "config") {
          if (item.cliKey === "llm-provider") {
            setPhase("provider-pick");
            const current = dirty["llm-provider"] ?? readSafe(Config.LlmProvider, "openrouter");
            setProviderPick(LLM_PROVIDERS.indexOf(current as LlmProvider));
            return;
          }
          const cliKey: string = item.cliKey ?? "";
          setEditValue(item.mask === true ? "" : (dirty[cliKey] ?? item.detail ?? ""));
          setPhase("edit");
          return;
        }
        if (item.kind === "action") {
          if (item.action === "save") {
            handleSave();
            return;
          }
          exit();
          onDone({ saved: false, command: undefined });
          return;
        }
      }
      return;
    }

    if (phase === "edit") {
      if (key.escape) {
        setPhase("browse");
        return;
      }
      if (key.return) {
        const item = items[cursor];
        if (item?.cliKey !== undefined) {
          const cliKey: string = item.cliKey;
          setDirty((prev) => ({ ...prev, [cliKey]: editValue }));
          setPhase("browse");
        }
        return;
      }
      return;
    }

    if (phase === "provider-pick") {
      if (key.upArrow || input === "k") {
        setProviderPick((p) => (p > 0 ? p - 1 : LLM_PROVIDERS.length - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setProviderPick((p) => (p < LLM_PROVIDERS.length - 1 ? p + 1 : 0));
        return;
      }
      if (key.escape) {
        setPhase("browse");
        return;
      }
      if (key.return) {
        setDirty((prev) => ({ ...prev, "llm-provider": LLM_PROVIDERS[providerPick] ?? "openrouter" }));
        setPhase("browse");
      }
    }
  });

  const dirtyCount = Object.keys(dirty).length;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Bytebell Tinker
        </Text>
        {dirtyCount > 0 && (
          <Text color="yellow">
            {" "}
            ({dirtyCount} unsaved change{dirtyCount > 1 ? "s" : ""})
          </Text>
        )}
      </Box>

      {items.map((item, i) => (
        <ItemRow
          key={
            item.kind === "section"
              ? `s-${item.label || "sp"}`
              : item.kind === "config"
                ? `c-${item.cliKey}`
                : item.kind === "action"
                  ? `a-${item.action}`
                  : `m-${item.label}`
          }
          item={item}
          isFocused={i === cursor}
          phase={phase}
          dirty={dirty}
          editValue={editValue}
          setEditValue={setEditValue}
          providerPick={providerPick}
        />
      ))}

      <Box marginTop={1}>
        {savedMsg !== null ? (
          <Text color="green">{savedMsg}</Text>
        ) : (
          <Text dimColor>[↑/↓ or j/k] navigate [Enter] select [Esc] leave</Text>
        )}
      </Box>
    </Box>
  );
}
