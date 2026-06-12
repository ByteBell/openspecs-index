import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { MenuSelector, type MenuGroup, type MenuSelectorResult } from "./MenuSelector.tsx";
import { LlmConfigForm, type LlmConfigFormResult } from "./LlmConfigForm.tsx";
import { ArgPrompt, type ArgSpec, type ArgPromptResult } from "./ArgPrompt.tsx";
import { buildProgram } from "./program.ts";
import { success } from "./output.ts";

/** Section layout for the menu. `id` matches a command name, except the
 * synthetic "configure-llm" entry which opens the dedicated LLM form. */
const GROUPS: readonly MenuGroup[] = [
  {
    title: "Setup",
    items: [
      { id: "configure-llm", glyph: "⚙", label: "Configure LLM provider", hint: "switch openrouter/ollama · key" },
      { id: "set", glyph: "⚙", label: "Settings", hint: "infra config / setup form" },
      { id: "mcp-install", glyph: "⧉", label: "Connect MCP clients", hint: "register bytebell in your editors" },
    ],
  },
  {
    title: "Knowledge",
    items: [
      { id: "index", glyph: "✚", label: "Index repo", hint: "clone + analyse a git repo" },
      { id: "ingest", glyph: "⤓", label: "Ingest folder", hint: "analyse a local directory" },
      { id: "pull", glyph: "↻", label: "Pull / re-index", hint: "refresh a repo at branch HEAD" },
      { id: "ls", glyph: "≡", label: "List repos", hint: "browse indexed knowledge" },
      { id: "delete", glyph: "✕", label: "Delete repo", hint: "remove from Mongo + Neo4j" },
    ],
  },
  {
    title: "Server",
    items: [
      { id: "boot", glyph: "▲", label: "Boot", hint: "start server (+ Docker infra if needed)" },
      { id: "shutdown", glyph: "■", label: "Shutdown", hint: "stop the server" },
    ],
  },
  {
    title: "Insights",
    items: [
      { id: "stats", glyph: "▤", label: "Stats", hint: "ingestion + token usage" },
      { id: "mcp", glyph: "◷", label: "MCP usage", hint: "tokens by month" },
    ],
  },
];

/** Commands that need positional arguments collected before dispatch. */
const ARG_SPECS: Record<string, readonly ArgSpec[]> = {
  index: [{ name: "git-url", placeholder: "e.g. https://github.com/owner/repo" }],
  ingest: [{ name: "path", optional: true, placeholder: "blank = current directory" }],
};

/**
 * Maps a menu id to the argv tokens it dispatches to. Defaults to `[id]`;
 * entries here exist where the useful action is a sub-subcommand rather than
 * the bare parent (e.g. `mcp` alone only prints help — the usage view is
 * `mcp stats`).
 */
const DISPATCH: Record<string, readonly string[]> = {
  mcp: ["mcp", "stats"],
  "mcp-install": ["mcp", "install"],
};

export function buildMenuCommand(): Command {
  const cmd = new Command("menu");
  cmd.description("Open the interactive command menu (default when run with no command).").action(runMenu);
  return cmd;
}

/**
 * Drives the menu in a loop so the user goes "back and forth" between
 * commands: every command / form returns to the menu instead of exiting.
 * The loop ends only when the user quits at the menu (Esc/q) or quits from a
 * sub-screen via Esc (the `quit` signal). `q` inside a sub-screen backs out
 * to the menu without quitting.
 */
export async function runMenu(): Promise<void> {
  for (;;) {
    const choice = await renderMenu();
    if (choice.cancelled === true || choice.id === undefined) {
      return; // Esc / q at the menu → leave entirely
    }
    if (choice.id === "configure-llm") {
      if (await renderLlmForm()) {
        return; // Esc inside the form → leave entirely
      }
      continue; // saved or backed out → return to menu
    }
    const specs = ARG_SPECS[choice.id];
    if (specs !== undefined) {
      const args = await collectArgs(choice.id, specs);
      if (args === null) {
        continue; // backed out of the arg prompt → return to menu
      }
      await dispatch(choice.id, args);
      continue;
    }
    await dispatch(choice.id, []);
  }
}

async function collectArgs(command: string, specs: readonly ArgSpec[]): Promise<string[] | null> {
  const result = await renderArgPrompt(command, specs);
  if (result.cancelled === true || result.values === undefined) {
    return null;
  }
  // Drop trailing empty optional args so commander applies its own defaults.
  return result.values.filter((v) => v.length > 0);
}

async function dispatch(command: string, args: readonly string[]): Promise<void> {
  const node = process.argv[0] ?? "bun";
  const script = process.argv[1] ?? "bytebell-tinker";
  const tokens = DISPATCH[command] ?? [command];
  const program = buildProgram();
  await program.parseAsync([node, script, ...tokens, ...args]);
}

/**
 * Tears down an Ink instance so the rendered UI vanishes instead of being
 * left in the scrollback. `clear()` erases the last frame and `unmount()`
 * stops the app without re-painting it — call order matters, and neither is
 * triggered from inside the components (they only invoke their `onDone`).
 */
function teardown(instance: ReturnType<typeof render>): void {
  instance.clear();
  instance.unmount();
}

function renderMenu(): Promise<MenuSelectorResult> {
  return new Promise((resolve) => {
    const instance = render(
      React.createElement(MenuSelector, {
        groups: GROUPS,
        onDone: (result: MenuSelectorResult) => {
          teardown(instance);
          resolve(result);
        },
      }),
    );
    instance.waitUntilExit().catch(() => resolve({ cancelled: true }));
  });
}

function renderArgPrompt(command: string, specs: readonly ArgSpec[]): Promise<ArgPromptResult> {
  const meta = buildProgram().commands.find((c) => c.name() === command);
  const description = meta?.description() ?? "";
  return new Promise((resolve) => {
    const instance = render(
      React.createElement(ArgPrompt, {
        title: command,
        description,
        specs,
        onDone: (result: ArgPromptResult) => {
          teardown(instance);
          resolve(result);
        },
      }),
    );
    instance.waitUntilExit().catch(() => resolve({ cancelled: true }));
  });
}

/** Resolves `true` when the user quit the whole TUI from the form (Esc),
 * `false` when they saved or backed out to the menu. */
function renderLlmForm(): Promise<boolean> {
  return new Promise((resolve) => {
    const instance = render(
      React.createElement(LlmConfigForm, {
        onDone: (result: LlmConfigFormResult) => {
          teardown(instance);
          if (result.saved === true) {
            success("LLM provider config saved to ~/.bytebell/config.json");
          }
          resolve(result.quit === true);
        },
      }),
    );
    instance.waitUntilExit().catch(() => resolve(false));
  });
}
