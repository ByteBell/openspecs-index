import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { TinkerMenu } from "./TinkerMenu.tsx";

export function buildTinkerCommand(): Command {
  const cmd = new Command("tinker");
  cmd.description("Interactive control panel — browse commands, configure AI, save & go.").action(runTinker);
  return cmd;
}

async function runTinker(): Promise<void> {
  return new Promise((resolve) => {
    const onDone = () => resolve();
    const { waitUntilExit } = render(React.createElement(TinkerMenu, { onDone }));
    waitUntilExit().catch(() => undefined);
  });
}
