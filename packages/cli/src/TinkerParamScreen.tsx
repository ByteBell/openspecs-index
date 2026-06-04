// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { useState } from "react";
import type { ReactElement } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { spawnSync } from "child_process";

export interface CmdParam {
  label: string;
  placeholder: string;
  required: boolean;
}

export interface CmdEntry {
  cmd: string;
  desc: string;
  spawnArgs: string[];
  param: CmdParam | null;
}

export const COMMANDS_LIST: readonly CmdEntry[] = [
  { cmd: "boot", desc: "Bring up Docker infra", spawnArgs: ["boot"], param: null },
  { cmd: "shutdown", desc: "Stop Docker infra", spawnArgs: ["shutdown"], param: null },
  { cmd: "server", desc: "Start MCP Server", spawnArgs: ["server", "start"], param: null },
  {
    cmd: "index",
    desc: "Index a remote Git repository",
    spawnArgs: ["index"],
    param: { label: "Git URL (https://…)", placeholder: "https://github.com/owner/repo", required: true },
  },
  {
    cmd: "ingest",
    desc: "Ingest local directory",
    spawnArgs: ["ingest"],
    param: { label: "Directory path (Enter for CWD)", placeholder: "/path/to/project", required: false },
  },
  {
    cmd: "pull",
    desc: "Pull latest from indexed repo",
    spawnArgs: ["pull"],
    param: { label: "Knowledge ID (Enter for picker)", placeholder: "UUID or Enter to pick", required: false },
  },
  { cmd: "ls", desc: "List indexed repos", spawnArgs: ["ls"], param: null },
  { cmd: "stats", desc: "Show graph and DB stats", spawnArgs: ["stats"], param: null },
];

interface TinkerParamScreenProps {
  entry: CmdEntry;
  onBack: () => void;
}

export function TinkerParamScreen({ entry, onBack }: TinkerParamScreenProps): ReactElement {
  const [paramInput, setParamInput] = useState("");

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      process.exit(0);
    }
    if (key.return) {
      if (entry.param?.required && paramInput.length === 0) {
        return;
      }
      const args = [...entry.spawnArgs];
      if (paramInput.length > 0) {
        args.push(paramInput);
      }
      console.clear();
      spawnSync("bytebell", args, { stdio: "inherit" });
      process.exit(0);
    }
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={100}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">
          === Bytebell Tinker Menu ===
        </Text>
      </Box>

      <Box flexDirection="column" paddingY={1}>
        <Text bold color="yellow">
          {entry.param?.label}
        </Text>
        <Box paddingLeft={2} marginTop={1}>
          <TextInput
            focus={true}
            value={paramInput}
            onChange={setParamInput}
            placeholder={entry.param?.placeholder ?? ""}
          />
        </Box>
        {entry.param?.required && paramInput.length === 0 && (
          <Box paddingLeft={2} marginTop={1}>
            <Text color="red">This field is required</Text>
          </Box>
        )}
      </Box>

      <Box
        borderStyle="single"
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor="gray"
        paddingTop={1}
        justifyContent="space-between"
      >
        <Text color="gray">
          <Text bold>Enter</Text> to run | <Text bold>Esc</Text> to go back to menu
        </Text>
        <Text color="red">Press Ctrl+C to quit</Text>
      </Box>
    </Box>
  );
}
