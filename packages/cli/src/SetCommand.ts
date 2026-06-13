import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { SecretSource } from "@bb/types";
import { HINTS, getConfigValue, getSecretSource, isSecretKey } from "@bb/config";
import { KEY_MAP, validKeysList } from "./keyMap.ts";
import { SetupForm } from "./SetupForm.tsx";
import { error, list, success, warn } from "./output.ts";

export function buildSetCommand(): Command {
  const cmd = new Command("set");

  cmd
    .argument("[key]", `Configuration key to set (${validKeysList()})`)
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

  const mappedKey = KEY_MAP[key];
  if (!mappedKey) {
    error(`Invalid key: ${key}`);
    list("Valid keys:", Object.keys(KEY_MAP));
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
    // Secrets route to the OS keychain via their setter; report where it landed.
    if (isSecretKey(mappedKey.configKey)) {
      if (getSecretSource(mappedKey.configKey) === SecretSource.Keychain) {
        success(`Set ${key} (stored in OS keychain).`);
      } else {
        success(`Set ${key} (plaintext).`);
        warn(`No OS keychain backend available — ${key} was written to config.json in plaintext.`);
      }
    } else {
      success(`Set ${key} to ${mappedKey.redact ? "<redacted>" : value}`);
    }
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

async function runInteractive(): Promise<void> {
  return new Promise((resolve) => {
    const onDone = () => resolve();
    const { waitUntilExit } = render(React.createElement(SetupForm, { onDone }));
    waitUntilExit().catch(() => undefined);
  });
}
