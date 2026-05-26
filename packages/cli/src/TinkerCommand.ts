import { Command } from "commander";
import { spawn } from "node:child_process";
import path from "node:path";
import { homedir } from "node:os";
import React from "react";
import { render } from "ink";
import { TinkerMenu } from "./TinkerMenu.tsx";

interface TinkerResult {
  saved: boolean;
  command?: string;
}

export function buildTinkerCommand(): Command {
  const cmd = new Command("tinker");
  cmd.description("Interactive control panel — browse commands, configure AI, save & go.").action(runTinker);
  return cmd;
}

async function runTinker(): Promise<void> {
  while (true) {
    const result = await showMenu();
    if (result.command !== undefined) {
      await runBytebellCommand(result.command);
      continue;
    }
    break;
  }
}

function showMenu(): Promise<TinkerResult> {
  return new Promise((resolve) => {
    const onDone = (r: TinkerResult) => resolve(r);
    const { waitUntilExit } = render(React.createElement(TinkerMenu, { onDone }));
    waitUntilExit().catch(() => resolve({ saved: false }));
  });
}

function resolveBytebellBin(): string {
  return path.join(homedir(), ".bun", "bin", "bytebell");
}

function runBytebellCommand(subcommand: string): Promise<void> {
  const binPath = resolveBytebellBin();
  return new Promise((resolve) => {
    const child = spawn(binPath, [subcommand], { stdio: "inherit" });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}
