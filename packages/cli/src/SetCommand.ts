import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { HINTS, getConfigValue } from "@bb/config";
import { KEY_MAP, validKeysList } from "./keyMap.ts";
import { applyInfraMode, currentInfraMode, type InfraMode } from "./infraMode.ts";
import { SetupForm } from "./SetupForm.tsx";
import { error, list, success } from "./output.ts";

const INFRA_MODES: readonly InfraMode[] = ["embedded", "docker"];

export function buildSetCommand(): Command {
  const cmd = new Command("set");

  cmd
    .argument("[key]", `Configuration key to set (mode, ${validKeysList()})`)
    .argument("[value]", "New value for the key")
    .action(runSet);

  return cmd;
}

async function runSet(key?: string, value?: string): Promise<void> {
  if (key === undefined && value === undefined) {
    await runInteractive();
    return;
  }
  if (key === undefined) {
    error(`"set" requires a <key> (or no args for the interactive form)`);
    process.exitCode = 1;
    return;
  }

  // `mode` is not a single config key — it's a preset that switches the three
  // provider keys at once and auto-fills the per-service config they need.
  if (key === "mode") {
    setMode(value);
    return;
  }

  const mappedKey = KEY_MAP[key];
  if (!mappedKey) {
    error(`Invalid key: ${key}`);
    list("Valid keys:", ["mode", ...Object.keys(KEY_MAP)]);
    process.exitCode = 1;
    return;
  }

  // No value given: a toggle key flips to its other option; anything else errors.
  if (value === undefined) {
    if (mappedKey.toggleValues === undefined) {
      error(`"set ${key}" requires a <value>`);
      process.exitCode = 1;
      return;
    }
    const [a, b] = mappedKey.toggleValues;
    const current = String(getConfigValue(mappedKey.configKey));
    const next = current === a ? b : a;
    try {
      mappedKey.setter(next);
      success(`${key}: ${current.length > 0 ? current : "(unset)"} -> ${next}`);
    } catch (err: unknown) {
      error(`Failed to toggle ${key}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    return;
  }

  try {
    mappedKey.setter(value);
    success(`Set ${key} to ${mappedKey.redact ? "<redacted>" : value}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error(`Failed to set ${key}: ${message}`);
    const hint = HINTS[mappedKey.configKey];
    if (hint) {
      list("Hint:", [hint]);
    }
    process.exitCode = 1;
  }
}

function setMode(value?: string): void {
  const current = currentInfraMode();
  // No value: flip to the other preset (mirrors the toggle keys in KEY_MAP).
  const next = value === undefined ? (current === "embedded" ? "docker" : "embedded") : value;
  if (next !== "embedded" && next !== "docker") {
    error(`Invalid value for "mode": expected one of ${INFRA_MODES.join(", ")}, got "${value}"`);
    process.exitCode = 1;
    return;
  }
  try {
    const result = applyInfraMode(next);
    success(`mode: ${current} -> ${next}`);
    for (const entry of result.written) {
      success(`  set ${entry.cliKey}${entry.redacted ? "=<redacted>" : ""} (auto-filled with default)`);
    }
  } catch (err: unknown) {
    error(`Failed to set mode: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function runInteractive(): Promise<void> {
  return new Promise((resolve) => {
    const onDone = () => resolve();
    const { waitUntilExit } = render(React.createElement(SetupForm, { onDone }));
    waitUntilExit().catch(() => undefined);
  });
}
