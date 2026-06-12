import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { ACCENT } from "./theme.ts";

export type PullMode = "latest" | "specific";

export interface PullModeSelectorResult {
  mode?: PullMode;
  cancelled?: boolean;
}

export interface PullModeSelectorProps {
  repoLabel: string;
  onDone: (result: PullModeSelectorResult) => void;
}

interface Choice {
  mode: PullMode;
  label: string;
  hint: string;
}

const CHOICES: readonly Choice[] = [
  { mode: "latest", label: "Pull to latest HEAD", hint: "branch tip on origin" },
  { mode: "specific", label: "Pick a specific commit", hint: "searchable list of recent commits on the branch" },
];

/**
 * Two-option chooser shown after a single repo is selected in `bytebell pull`.
 * The user picks between pulling to the branch's HEAD (default behaviour) or
 * picking a specific commit from the branch history.
 */
export function PullModeSelector({ repoLabel, onDone }: PullModeSelectorProps): ReactElement {
  const { exit } = useApp();
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      exit();
      onDone({ cancelled: true });
      return;
    }
    if (key.upArrow || input === "k") {
      setIndex((i) => (i > 0 ? i - 1 : CHOICES.length - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setIndex((i) => (i < CHOICES.length - 1 ? i + 1 : 0));
      return;
    }
    if (key.return) {
      const chosen = CHOICES[index];
      exit();
      onDone(chosen === undefined ? { cancelled: true } : { mode: chosen.mode });
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>How should we pull </Text>
        <Text bold color={ACCENT}>
          {repoLabel}
        </Text>
        <Text bold>?</Text>
      </Box>
      {CHOICES.map((choice, i) => (
        <Box key={choice.mode}>
          <Text color={i === index ? ACCENT : "gray"}>{i === index ? "▶ " : "  "}</Text>
          <Text color={i === index ? ACCENT : "gray"}>{choice.label}</Text>
          <Text dimColor>{` — ${choice.hint}`}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>[↑/↓ or j/k] move [Enter] choose [Esc] cancel</Text>
      </Box>
    </Box>
  );
}
