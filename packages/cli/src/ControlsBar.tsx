import type { ReactElement } from "react";
import { Box, Text } from "ink";
import { ACCENT } from "./theme.ts";

export interface Control {
  /** The key(s) to press, shown as a highlighted cap — e.g. "↑ ↓", "⏎", "esc". */
  keys: string;
  /** What the key does, in lower-case — e.g. "navigate", "run". */
  label: string;
}

export interface ControlsBarProps {
  controls: readonly Control[];
  /** When set, rendered dim-right (used by the top-level menu footer). */
  version?: string;
}

/**
 * Universal footer control hint. Every screen renders the same component so
 * the key legend looks identical everywhere — keys appear as inverse "caps"
 * with a dim label beside them. Layout-neutral: it adds no outer padding, so
 * callers place it wherever the footer belongs (inside a form box, or under
 * the menu). Pass `version` only on the root menu.
 */
export function ControlsBar({ controls, version }: ControlsBarProps): ReactElement {
  return (
    <Box flexGrow={1} justifyContent={version === undefined ? "flex-start" : "space-between"}>
      <Box>
        {controls.map((c) => (
          <Box key={c.keys} marginRight={2}>
            <Text backgroundColor={ACCENT} color="white" bold>
              {` ${c.keys} `}
            </Text>
            <Text color="white" bold>
              {` ${c.label}`}
            </Text>
          </Box>
        ))}
      </Box>
      {version !== undefined && <Text dimColor>{`v${version}`}</Text>}
    </Box>
  );
}
