import type { ReactElement } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { LLM_PROVIDERS } from "@bb/config";
import type { MenuItem, Phase } from "./TinkerMenu.tsx";

function redact(val: string): string {
  if (val.length === 0) {
    return "(not set)";
  }
  return `${val.slice(0, 6)}${"*".repeat(Math.max(0, val.length - 6))}`;
}

interface ItemRowProps {
  item: MenuItem;
  isFocused: boolean;
  phase: Phase;
  dirty: Record<string, string>;
  editValue: string;
  setEditValue: (v: string) => void;
  providerPick: number;
}

export function ItemRow({
  item,
  isFocused,
  phase,
  dirty,
  editValue,
  setEditValue,
  providerPick,
}: ItemRowProps): ReactElement | null {
  const indicator = isFocused ? "▶" : " ";

  if (item.kind === "section") {
    if (item.label.length === 0) {
      return <Box height={0} />;
    }
    return (
      <Box marginTop={1} marginBottom={0}>
        <Text bold color="gray">
          ── {item.label} ──
        </Text>
      </Box>
    );
  }

  if (item.kind === "command") {
    return (
      <Box>
        <Text color={isFocused ? "cyan" : "gray"}>{indicator} </Text>
        <Box width={22}>
          <Text color={isFocused ? "cyan" : "gray"} bold={isFocused}>
            {item.label}
          </Text>
        </Box>
        <Text dimColor>{item.detail}</Text>
      </Box>
    );
  }

  if (item.kind === "config") {
    return renderConfigRow({ item, isFocused, phase, dirty, editValue, setEditValue, providerPick, indicator });
  }

  if (item.kind === "action") {
    const isSave = item.action === "save";
    const bg = isFocused ? (isSave ? "green" : "red") : undefined;
    return (
      <Box marginTop={1}>
        <Text color={isFocused ? (isSave ? "green" : "red") : "gray"}>{indicator} </Text>
        {bg !== undefined ? (
          <Text color="black" backgroundColor={bg} bold={isFocused}>
            {" "}
            {item.label}{" "}
          </Text>
        ) : (
          <Text bold={isFocused}> {item.label} </Text>
        )}
      </Box>
    );
  }

  return null;
}

function renderConfigRow({
  item,
  isFocused,
  phase,
  dirty,
  editValue,
  setEditValue,
  providerPick,
  indicator,
}: ItemRowProps & { indicator: string }): ReactElement {
  const cliKey = item.cliKey ?? "";
  const displayDetail =
    dirty[cliKey] !== undefined ? (item.mask === true ? redact(dirty[cliKey]) : dirty[cliKey]) : item.detail;

  if (isFocused && phase === "edit") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">▶ </Text>
          <Box width={22}>
            <Text color="cyan" bold>
              {item.label}
            </Text>
          </Box>
          <TextInput value={editValue} onChange={setEditValue} {...(item.mask ? { mask: "•" } : {})} />
        </Box>
        <Box paddingLeft={24}>
          <Text dimColor>[Enter] confirm [Esc] cancel</Text>
        </Box>
      </Box>
    );
  }

  if (isFocused && phase === "provider-pick" && cliKey === "llm-provider") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">▶ </Text>
          <Box width={22}>
            <Text color="cyan" bold>
              {item.label}
            </Text>
          </Box>
        </Box>
        {LLM_PROVIDERS.map((p) => (
          <Box key={p} paddingLeft={4}>
            <Text color={p === LLM_PROVIDERS[providerPick] ? "cyan" : "gray"}>
              {p === LLM_PROVIDERS[providerPick] ? "▶ " : "  "}
              {p}
            </Text>
          </Box>
        ))}
        <Box paddingLeft={24}>
          <Text dimColor>[↑/↓] pick [Enter] confirm [Esc] cancel</Text>
        </Box>
      </Box>
    );
  }

  const dirtyMarker = dirty[cliKey] !== undefined ? " *" : "";
  return (
    <Box>
      <Text color={isFocused ? "cyan" : "gray"}>{indicator} </Text>
      <Box width={22}>
        <Text color={isFocused ? "cyan" : "gray"} bold={isFocused}>
          {item.label}
          {dirtyMarker.length > 0 && <Text color="yellow">{dirtyMarker}</Text>}
        </Text>
      </Box>
      <Text dimColor={!isFocused}>{displayDetail}</Text>
    </Box>
  );
}
