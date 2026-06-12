import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { ACCENT } from "./theme.ts";

export interface BranchSelectorResult {
  branch?: string;
  typeManually?: boolean;
  cancelled?: boolean;
}

export interface BranchSelectorProps {
  branches: string[];
  title?: string;
  onDone: (result: BranchSelectorResult) => void;
}

const MAX_VISIBLE = 12;

type ItemKind = "branch" | "manual";

export function BranchSelector({ branches: rawBranches, title, onDone }: BranchSelectorProps): ReactElement {
  const { exit } = useApp();
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);

  const branches = useMemo(() => {
    const items: Array<{ label: string; kind: ItemKind }> = rawBranches.map((b) => ({
      label: b,
      kind: "branch",
    }));
    items.push({ label: "Type manually...", kind: "manual" });
    return items;
  }, [rawBranches]);

  const filtered = useMemo(() => {
    if (filter.length === 0) {
      return branches;
    }
    const needle = filter.toLowerCase();
    return branches.filter((item) => item.label.toLowerCase().includes(needle));
  }, [branches, filter]);

  const boundedIndex = filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1);

  useInput((input, key) => {
    if (key.escape) {
      exit();
      onDone({ cancelled: true });
      return;
    }
    if (key.return) {
      const chosen = filtered[boundedIndex];
      if (!chosen) {
        exit();
        onDone({ cancelled: true });
        return;
      }
      exit();
      if (chosen.kind === "manual") {
        onDone({ typeManually: true });
      } else {
        onDone({ branch: chosen.label });
      }
      return;
    }
    if (key.upArrow || (input === "k" && filter.length === 0)) {
      setIndex(() => (boundedIndex > 0 ? boundedIndex - 1 : Math.max(filtered.length - 1, 0)));
      return;
    }
    if (key.downArrow || (input === "j" && filter.length === 0)) {
      setIndex(() => (boundedIndex < filtered.length - 1 ? boundedIndex + 1 : 0));
      return;
    }
    if (key.backspace || key.delete) {
      setFilter((s) => s.slice(0, -1));
      setIndex(0);
      return;
    }
    if (input.length > 0 && !key.ctrl && !key.meta) {
      setFilter((s) => s + input);
      setIndex(0);
    }
  });

  const heading = title ?? "Select a branch";
  const visibleStart = clampWindow(boundedIndex, filtered.length, MAX_VISIBLE);
  const visible = filtered.slice(visibleStart, visibleStart + MAX_VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>{heading}</Text>
        <Text dimColor>{`  (${filtered.length}/${branches.length})`}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={ACCENT}>filter: </Text>
        <Text>{filter.length > 0 ? filter : <Text dimColor>(type to filter)</Text>}</Text>
      </Box>
      {filtered.length === 0 ? (
        <Box>
          <Text dimColor>No branches match the filter. Backspace to clear.</Text>
        </Box>
      ) : (
        visible.map((item, i) => {
          const absoluteIndex = visibleStart + i;
          const cursor = absoluteIndex === boundedIndex;
          const isManual = item.kind === "manual";
          return (
            <Box key={`${item.kind}-${item.label}`}>
              <Text color={cursor ? ACCENT : "gray"}>{cursor ? "▶ " : "  "}</Text>
              <Text color={cursor ? ACCENT : isManual ? "yellow" : "white"}>{item.label}</Text>
            </Box>
          );
        })
      )}
      <Box marginTop={1}>
        <Text dimColor>[type to filter] [↑/↓] move [Enter] choose [Backspace] clear [Esc] cancel</Text>
      </Box>
    </Box>
  );
}

function clampWindow(index: number, total: number, size: number): number {
  if (total <= size) {
    return 0;
  }
  const halfWindow = Math.floor(size / 2);
  const start = Math.max(0, Math.min(index - halfWindow, total - size));
  return start;
}
