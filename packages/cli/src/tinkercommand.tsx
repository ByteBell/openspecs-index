// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { useState } from "react";
import { Command } from "commander";
import { render, Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { execSync, spawnSync } from "child_process";
import { COMMANDS_LIST, TinkerParamScreen } from "./TinkerParamScreen.tsx";

type Screen = "menu" | "paramInput";

const TinkerUI = () => {
  const [screen, setScreen] = useState<Screen>("menu");
  const [activePanel, setActivePanel] = useState<"commands" | "config" | "actions">("commands");
  const [lastTopPanel, setLastTopPanel] = useState<"commands" | "config">("commands");

  const [cmdIndex, setCmdIndex] = useState(0);

  const [configFocus, setConfigFocus] = useState<"provider" | "input">("provider");
  const [apiMode, setApiMode] = useState<"openrouter" | "local">("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [saveMessage, setSaveMessage] = useState("");

  const [actionFocus, setActionFocus] = useState<"leave" | "save">("save");

  const selectedCmd = COMMANDS_LIST[cmdIndex] as (typeof COMMANDS_LIST)[number];

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    if (activePanel === "commands") {
      if (key.rightArrow) {
        setActivePanel("config");
        setLastTopPanel("config");
        setSaveMessage("");
      }
      if (key.downArrow) {
        if (cmdIndex < COMMANDS_LIST.length - 1) {
          setCmdIndex((prev) => prev + 1);
        } else {
          setActivePanel("actions");
        }
      }
      if (key.upArrow && cmdIndex > 0) {
        setCmdIndex((prev) => prev - 1);
      }

      if (key.return) {
        if (selectedCmd.param !== null) {
          setScreen("paramInput");
        } else {
          console.clear();
          spawnSync("bytebell", selectedCmd.spawnArgs, { stdio: "inherit" });
          process.exit(0);
        }
      }
    } else if (activePanel === "config") {
      if (key.leftArrow && configFocus !== "input") {
        setActivePanel("commands");
        setLastTopPanel("commands");
        setSaveMessage("");
      }
      if (key.downArrow) {
        if (configFocus === "provider") {
          setConfigFocus("input");
        } else {
          setActivePanel("actions");
        }
      }
      if (key.upArrow && configFocus === "input") {
        setConfigFocus("provider");
      }

      if (configFocus === "provider" && (input === " " || key.return)) {
        setApiMode((prev) => (prev === "openrouter" ? "local" : "openrouter"));
      }

      if (configFocus === "input" && key.return) {
        saveConfigState();
      }
    } else if (activePanel === "actions") {
      if (key.upArrow) {
        setActivePanel(lastTopPanel);
      }
      if (key.leftArrow) {
        setActionFocus("leave");
      }
      if (key.rightArrow) {
        setActionFocus("save");
      }

      if (key.return) {
        if (actionFocus === "leave") {
          process.exit(0);
        }
        if (actionFocus === "save") {
          saveConfigState();
          process.exit(0);
        }
      }
    }

    if (input === "q" && activePanel !== "config") {
      process.exit(0);
    }
  });

  const saveConfigState = () => {
    try {
      execSync(`bytebell set llm-provider "${apiMode === "local" ? "ollama" : "openrouter"}"`);

      if (apiMode === "openrouter" && apiKey.length > 0) {
        execSync(`bytebell set openrouter-api-key "${apiKey}"`);
      } else if (apiMode === "local" && ollamaUrl.length > 0) {
        execSync(`bytebell set ollama-url "${ollamaUrl}"`);
      }

      setSaveMessage("✓ Settings saved!");
      setApiKey("");
    } catch {
      setSaveMessage("✗ Failed to save.");
    }
  };

  if (screen === "paramInput") {
    return <TinkerParamScreen entry={selectedCmd} onBack={() => setScreen("menu")} />;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={100}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">
          === Bytebell Tinker Menu ===
        </Text>
      </Box>

      <Box minHeight={11}>
        <Box
          flexDirection="column"
          width="50%"
          paddingRight={2}
          borderStyle="single"
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          borderRight={true}
          borderColor="gray"
        >
          <Text bold color={activePanel === "commands" ? "green" : "white"}>
            {"\n"}
            {activePanel === "commands" ? "> [ Available Commands ]" : "  [ Available Commands ]"}
          </Text>
          {COMMANDS_LIST.map((item, i) => {
            const isSelected = activePanel === "commands" && cmdIndex === i;
            return (
              <Box key={i} flexDirection="row" width="100%">
                <Box width={12}>
                  <Text color={isSelected ? "cyanBright" : "gray"}>
                    {isSelected ? " > " : "   "}
                    {item.cmd}
                  </Text>
                </Box>
                <Box flexShrink={1}>
                  <Text color={isSelected ? "cyanBright" : "gray"}>{item.desc}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>

        <Box flexDirection="column" width="50%" paddingLeft={2}>
          <Text bold color={activePanel === "config" ? "green" : "white"}>
            {"\n"}
            {activePanel === "config" ? "> [ API Configuration ]" : "  [ API Configuration ]"}
          </Text>

          <Box flexDirection="column" marginTop={1}>
            <Text color={activePanel === "config" && configFocus === "provider" ? "yellow" : "gray"}>
              {activePanel === "config" && configFocus === "provider" ? "> " : "  "}Select LLM Provider:
            </Text>
            <Box marginTop={1} flexDirection="column" paddingLeft={2}>
              <Text color={apiMode === "openrouter" ? "blueBright" : "gray"}>
                {apiMode === "openrouter" ? "◉ OpenRouter (Cloud)" : "◯ OpenRouter (Cloud)"}
              </Text>
              <Text color={apiMode === "local" ? "blueBright" : "gray"}>
                {apiMode === "local" ? "◉ Local (Ollama)" : "◯ Local (Ollama)"}
              </Text>
            </Box>
          </Box>

          <Box flexDirection="column" marginTop={2}>
            <Text color={activePanel === "config" && configFocus === "input" ? "yellow" : "gray"}>
              {activePanel === "config" && configFocus === "input" ? "> " : "  "}
              {apiMode === "openrouter" ? "OpenRouter API Key:" : "Local Ollama URL:"}
            </Text>
            <Box paddingLeft={2}>
              {activePanel === "config" && configFocus === "input" ? (
                apiMode === "openrouter" ? (
                  <TextInput
                    focus={true}
                    value={apiKey}
                    onChange={setApiKey}
                    placeholder="Paste sk-or-... & hit Enter"
                    mask="*"
                  />
                ) : (
                  <TextInput focus={true} value={ollamaUrl} onChange={setOllamaUrl} />
                )
              ) : (
                <Text color="gray">{apiMode === "openrouter" ? "*****************" : ollamaUrl}</Text>
              )}
            </Box>
            {saveMessage && (
              <Box paddingLeft={2} marginTop={1}>
                <Text color={saveMessage.includes("✓") ? "green" : "red"}>{saveMessage}</Text>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <Box
        borderStyle="single"
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor="gray"
      >
        <Box
          width="50%"
          justifyContent="center"
          paddingY={1}
          borderStyle="single"
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          borderRight={true}
          borderColor="gray"
        >
          <Text
            color={activePanel === "actions" && actionFocus === "leave" ? "black" : "gray"}
            {...(activePanel === "actions" && actionFocus === "leave" ? { backgroundColor: "white" as const } : {})}
          >
            [ Leave ]
          </Text>
        </Box>
        <Box width="50%" justifyContent="center" paddingY={1}>
          <Text
            color={activePanel === "actions" && actionFocus === "save" ? "black" : "greenBright"}
            {...(activePanel === "actions" && actionFocus === "save"
              ? { backgroundColor: "greenBright" as const }
              : {})}
          >
            [ Save & Continue ]
          </Text>
        </Box>
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
        {activePanel === "commands" ? (
          <Text color="gray">
            Use <Text bold>↑ ↓</Text> to select | <Text bold>Enter</Text> to run | <Text bold>→</Text> for Config
          </Text>
        ) : activePanel === "config" ? (
          <Text color="gray">
            Use <Text bold>↑ ↓</Text> to focus | <Text bold>Enter</Text> to toggle/save
          </Text>
        ) : (
          <Text color="gray">
            Use <Text bold>← →</Text> to select button | <Text bold>Enter</Text> to execute
          </Text>
        )}
        <Text color="red">Press {activePanel === "config" && configFocus === "input" ? "Ctrl+C" : "'q'"} to quit</Text>
      </Box>
    </Box>
  );
};

export function buildTinkerCommand(): Command {
  const cmd = new Command("tinker");
  cmd.description("Open interactive configuration and command menu in TUI").action(() => {
    render(<TinkerUI />);
  });
  return cmd;
}
