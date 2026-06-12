import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { ACCENT } from "./theme.ts";

/**
 * Generic interactive selector for indexed repos.
 *
 * Two modes, controlled by `multi` (defaults to `true`):
 *
 * - **Multi (default):** Space toggles the row at the cursor on/off, Enter
 *   submits the current set of toggled rows, Esc cancels.
 * - **Single (`multi: false`):** up/down (or j/k) to move, Enter chooses
 *   the row, Esc cancels.
 *
 * In both modes, an optional confirm phase (set via `confirm`) gates the
 * resolution behind a y/N prompt — useful for destructive actions like
 * delete. The prompt callback receives the labels array, so the caller can
 * format "Delete X" or "Delete 3 entries" however it likes.
 *
 * `onDone` always receives an array of picked items: length 1 in single mode,
 * length ≥0 in multi mode (empty submit is treated as a no-op so the user can
 * still pick something instead of having Enter silently cancel).
 */

export interface RepoSelectorItem {
  knowledgeId: string;
  /** Primary line — e.g. `github:owner/repo@main`. */
  label: string;
  /** Dim secondary text — e.g. `PROCESSED  a3f0c1de…  142 files`. */
  detail: string;
}

export interface RepoSelectorConfirm {
  /** Yellow prompt rendered in the confirm phase. Receives picked labels. */
  prompt: (selectedLabels: string[]) => string;
}

export interface RepoSelectorResult {
  picked?: RepoSelectorItem[];
  cancelled?: boolean;
}

export interface RepoSelectorProps {
  items: RepoSelectorItem[];
  /** Heading shown above the list. Defaults to "Select an entry". */
  title: string | undefined;
  /** When true, Space toggles per-row selection and Enter submits the set. */
  multi: boolean | undefined;
  /** Optional confirm phase. Omit for non-destructive actions. */
  confirm: RepoSelectorConfirm | undefined;
  onDone: (result: RepoSelectorResult) => void;
}

type Phase = "select" | "confirm";

export function RepoSelector({ items, title, multi = true, confirm, onDone }: RepoSelectorProps): ReactElement {
  const { exit } = useApp();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("select");
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set<number>());

  const resolvePicked = (): RepoSelectorItem[] => {
    if (multi) {
      const sorted = [...selected].sort((a, b) => a - b);
      return sorted.map((i) => items[i]).filter((x): x is RepoSelectorItem => x !== undefined);
    }
    const cur = items[index];
    return cur === undefined ? [] : [cur];
  };

  const finish = (picked: RepoSelectorItem[]): void => {
    exit();
    onDone(picked.length === 0 ? { cancelled: true } : { picked });
  };

  useInput((input, key) => {
    if (key.escape) {
      exit();
      onDone({ cancelled: true });
      return;
    }
    if (phase === "select") {
      if (key.upArrow || input === "k") {
        setIndex((i) => (i > 0 ? i - 1 : items.length - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setIndex((i) => (i < items.length - 1 ? i + 1 : 0));
        return;
      }
      // Multi-mode: Space toggles the cursor row.
      if (multi && input === " ") {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(index)) {
            next.delete(index);
          } else {
            next.add(index);
          }
          return next;
        });
        return;
      }
      if (key.return) {
        const picked = resolvePicked();
        if (picked.length === 0) {
          // Multi-mode with nothing toggled — no-op so the user can still pick.
          return;
        }
        if (confirm === undefined) {
          finish(picked);
          return;
        }
        setPhase("confirm");
      }
      return;
    }
    if (phase === "confirm") {
      if (input === "y" || input === "Y") {
        finish(resolvePicked());
        return;
      }
      if (input === "n" || input === "N") {
        setPhase("select");
      }
    }
  });

  const heading = title ?? "Select an entry";
  const pickedLabels = resolvePicked().map((p) => p.label);

  const helpLine = multi
    ? "[↑/↓ or j/k] move [Space] toggle [Enter] confirm [Esc] cancel"
    : "[↑/↓ or j/k] move [Enter] choose [Esc] cancel";

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>
          {heading}
          {multi ? <Text dimColor>{`  (${selected.size} selected)`}</Text> : null}
        </Text>
      </Box>
      {items.map((item, i) => (
        <Box key={item.knowledgeId}>
          <Text color={i === index ? ACCENT : "gray"}>{i === index ? "▶ " : "  "}</Text>
          {multi ? <Text>{selected.has(i) ? "[x] " : "[ ] "}</Text> : null}
          <Text color={i === index ? ACCENT : "gray"}>{item.label}</Text>
          <Text dimColor> {item.detail}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        {phase === "select" ? (
          <Text dimColor>{helpLine}</Text>
        ) : (
          <Text color="yellow">{confirm?.prompt(pickedLabels) ?? ""}</Text>
        )}
      </Box>
    </Box>
  );
}
