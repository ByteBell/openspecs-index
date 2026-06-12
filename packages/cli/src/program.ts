import { Command } from "commander";
import { buildSetCommand } from "./SetCommand.ts";
import { buildSetupCommand } from "./SetupCommand.ts";
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
import { buildMigrateCommand } from "./MigratePathsCommand.ts";
import { buildMenuCommand } from "./MenuCommand.ts";
import { VERSION } from "./version.ts";

export { VERSION };

/**
 * Assembles the full `bytebell` commander program with every subcommand
 * registered. Extracted from `index.ts` so the interactive menu can build a
 * fresh program to dispatch a chosen command without re-parsing shared state.
 *
 * Single source of truth for the command list: `MenuSelector` introspects the
 * result of this function, so the menu never drifts from the real commands.
 */
export function buildProgram(): Command {
  const program = new Command("bytebell-tinker");
  program.version(VERSION).description("Bytebell Tinker — local knowledge engine TUI");
  program.addCommand(buildSetCommand());
  program.addCommand(buildSetupCommand());
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
  program.addCommand(buildMigrateCommand());
  program.addCommand(buildMenuCommand());
  return program;
}
