import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { ACCENT } from "./theme.ts";

/**
 * Interactive commit picker. Type any character to filter the list (matches
 * substring against the short hash, full hash, and subject). Up/down (or j/k)
 * to navigate the filtered view. Enter to choose, Esc to cancel.
 *
 * The component is single-select and intentionally narrow — the only thing
 * the caller gets back is the chosen commit's full hash, or null on cancel.
 */

export interface CommitSelectorItem {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export interface CommitSelectorResult {
  picked?: CommitSelectorItem;
  cancelled?: boolean;
}

export interface CommitSelectorProps {
  items: CommitSelectorItem[];
  title: string | undefined;
  onDone: (result: CommitSelectorResult) => void;
}

const MAX_VISIBLE = 12;

export function CommitSelector({ items, title, onDone }: CommitSelectorProps): ReactElement {
  const { exit } = useApp();
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);

  const filtered = useMemo<CommitSelectorItem[]>(() => {
    if (filter.length === 0) {
      return items;
    }
    const needle = filter.toLowerCase();
    return items.filter((item) => {
      if (item.shortHash.toLowerCase().includes(needle)) {
        return true;
      }
      if (item.hash.toLowerCase().includes(needle)) {
        return true;
      }
      if (item.subject.toLowerCase().includes(needle)) {
        return true;
      }
      if (item.author.toLowerCase().includes(needle)) {
        return true;
      }
      return false;
    });
  }, [items, filter]);

  // Keep the cursor inside the filtered range.
  const boundedIndex = filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1);

  useInput((input, key) => {
    if (key.escape) {
      exit();
      onDone({ cancelled: true });
      return;
    }
    if (key.return) {
      const chosen = filtered[boundedIndex];
      exit();
      onDone(chosen === undefined ? { cancelled: true } : { picked: chosen });
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
      // Type-to-filter: any printable character extends the filter.
      setFilter((s) => s + input);
      setIndex(0);
    }
  });

  const heading = title ?? "Pick a commit";
  const visibleStart = clampWindow(boundedIndex, filtered.length, MAX_VISIBLE);
  const visible = filtered.slice(visibleStart, visibleStart + MAX_VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>{heading}</Text>
        <Text dimColor>{`  (${filtered.length}/${items.length})`}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={ACCENT}>filter: </Text>
        <Text>{filter.length > 0 ? filter : <Text dimColor>(type to filter)</Text>}</Text>
      </Box>
      {filtered.length === 0 ? (
        <Box>
          <Text dimColor>No commits match the filter. Backspace to clear.</Text>
        </Box>
      ) : (
        visible.map((item, i) => {
          const absoluteIndex = visibleStart + i;
          const cursor = absoluteIndex === boundedIndex;
          return (
            <Box key={item.hash}>
              <Text color={cursor ? ACCENT : "gray"}>{cursor ? "▶ " : "  "}</Text>
              <Text color={cursor ? ACCENT : "gray"}>{item.shortHash}</Text>
              <Text dimColor>{` ${item.subject.slice(0, 80)} `}</Text>
              <Text dimColor>{`(${item.author}, ${formatDate(item.date)})`}</Text>
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
