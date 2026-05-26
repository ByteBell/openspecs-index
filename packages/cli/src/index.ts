#!/usr/bin/env bun
import { Command } from "commander";
import { buildSetCommand } from "./SetCommand.ts";
import { buildServerCommand } from "./ServerCommand.ts";
import { buildIndexCommand } from "./IndexCommand.ts";
import { buildIngestCommand } from "./IngestCommand.ts";
import { buildPullCommand } from "./PullCommand.ts";
import { buildLsCommand } from "./LsCommand.ts";
import { buildBootCommand } from "./BootCommand.ts";
import { buildShutdownCommand } from "./ShutdownCommand.ts";
import { buildDeleteCommand } from "./DeleteCommand.ts";
import { buildStatsCommand } from "./StatsCommand.ts";
import { buildMcpCommand } from "./McpCommand.ts";
import { buildTinkerCommand } from "./TinkerCommand.ts";
import { error } from "./output.ts";

const VERSION = "0.0.0";

async function main(): Promise<void> {
  const program = new Command("bytebell");
  program.version(VERSION).description("Bytebell — local knowledge engine TUI");
  program.addCommand(buildSetCommand());
  program.addCommand(buildBootCommand());
  program.addCommand(buildShutdownCommand());
  program.addCommand(buildServerCommand());
  program.addCommand(buildIndexCommand());
  program.addCommand(buildIngestCommand());
  program.addCommand(buildPullCommand());
  program.addCommand(buildLsCommand());
  program.addCommand(buildDeleteCommand());
  program.addCommand(buildStatsCommand());
  program.addCommand(buildMcpCommand());
  program.addCommand(buildTinkerCommand());
  await program.parseAsync(process.argv);
}

main().catch((cause: unknown) => {
  const msg = cause instanceof Error ? cause.message : String(cause);
  error(msg);
  process.exit(2);
});
