import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useInput } from "ink";
import { VERSION } from "./version.ts";
import { ControlsBar } from "./ControlsBar.tsx";
import { ACCENT } from "./theme.ts";

export interface MenuItem {
  /** Stable id used by the caller to dispatch (command name, or a synthetic id). */
  id: string;
  glyph: string;
  label: string;
  hint: string;
}

export interface MenuGroup {
  title: string;
  items: readonly MenuItem[];
}

export interface MenuSelectorResult {
  id?: string;
  cancelled?: boolean;
}

export interface MenuSelectorProps {
  groups: readonly MenuGroup[];
  onDone: (result: MenuSelectorResult) => void;
}

/** Flattens grouped items into the linear order the cursor walks. */
function flatten(groups: readonly MenuGroup[]): MenuItem[] {
  return groups.flatMap((g) => g.items);
}

/**
 * Top-level command picker for `bytebell menu` (and a bare `bytebell`).
 *
 * Rows are grouped into labelled sections (SETUP / KNOWLEDGE / …) but the
 * cursor walks a single flat order, skipping the section headers. ↑/↓ or j/k
 * move (wrapping), Enter chooses, Esc/q quits. The group list is supplied by
 * the caller so the menu never drifts from the real commander program.
 */
export function MenuSelector({ groups, onDone }: MenuSelectorProps): ReactElement {
  const flat = flatten(groups);
  const [index, setIndex] = useState(0);
  const activeId = flat[index]?.id;

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onDone({ cancelled: true });
      return;
    }
    if (key.upArrow || input === "k") {
      setIndex((i) => (i > 0 ? i - 1 : flat.length - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setIndex((i) => (i < flat.length - 1 ? i + 1 : 0));
      return;
    }
    if (key.return) {
      const chosen = flat[index];
      onDone(chosen === undefined ? { cancelled: true } : { id: chosen.id });
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={0}>
        <Box marginY={1} flexDirection="column">
          <Text bold color={ACCENT}>
            Bytebell Tinker
          </Text>
          <Text dimColor>local knowledge engine · open-ir</Text>
        </Box>
        {groups.map((group) => (
          <Box key={group.title} flexDirection="column" marginBottom={1}>
            <Text dimColor bold>
              {group.title.toUpperCase()}
            </Text>
            {group.items.map((item) => {
              const active = item.id === activeId;
              const activeProps = active ? { color: ACCENT } : {};
              return (
                <Box key={item.id}>
                  <Text color={ACCENT}>{active ? " ❯ " : "   "}</Text>
                  <Box width={3}>
                    <Text {...activeProps}>{item.glyph}</Text>
                  </Box>
                  <Box width={24}>
                    <Text {...activeProps} bold={active}>
                      {item.label}
                    </Text>
                  </Box>
                  <Text dimColor>{item.hint}</Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
      <Box paddingX={2}>
        <ControlsBar
          controls={[
            { keys: "↑ ↓", label: "navigate" },
            { keys: "⏎", label: "run" },
            { keys: "esc", label: "quit" },
          ]}
          version={VERSION}
        />
      </Box>
    </Box>
  );
}
