import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { ACCENT } from "./theme.ts";

export interface InitialBranchResult {
  choice?: "default" | "other";
  cancelled?: boolean;
}

export interface InitialBranchProps {
  defaultBranch: string;
  onDone: (result: InitialBranchResult) => void;
}

export function InitialBranchSelector({ defaultBranch, onDone }: InitialBranchProps): ReactElement {
  const { exit } = useApp();
  const [index, setIndex] = useState(0);

  const items = [
    { label: `Default branch (${defaultBranch})`, value: "default" as const },
    { label: "Other branch...", value: "other" as const },
  ];

  useInput((_input, key) => {
    if (key.escape) {
      exit();
      onDone({ cancelled: true });
      return;
    }
    if (key.return) {
      exit();
      const choice = items[index]?.value;
      if (choice) {
        onDone({ choice });
      } else {
        onDone({ cancelled: true });
      }
      return;
    }
    if (key.upArrow) {
      setIndex(0);
    }
    if (key.downArrow) {
      setIndex(1);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Which branch would you like to index?</Text>
      </Box>
      {items.map((item, i) => {
        const cursor = i === index;
        return (
          <Box key={item.value}>
            <Text color={cursor ? ACCENT : "gray"}>{cursor ? "▶ " : "  "}</Text>
            <Text color={cursor ? ACCENT : "white"}>{item.label}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>[↑/↓] move [Enter] choose [Esc] cancel</Text>
      </Box>
    </Box>
  );
}
