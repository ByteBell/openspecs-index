// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { error, info, success } from "./output.ts";

const GLOBAL_BIN_DIRS = ["/usr/local/bin", "/opt/homebrew/bin"];

export interface LinkResult {
  linked: boolean;
  target: string;
  linkPath: string;
}

function resolveCliEntry(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "index.ts");
}

function findBytebellOnPath(): string | null {
  try {
    const result = spawnSync("which", ["bytebell"], { encoding: "utf8" });
    if (result.status === 0 && typeof result.stdout === "string" && result.stdout.trim().length > 0) {
      return result.stdout.trim();
    }
  } catch {
    // which not available
  }
  return null;
}
function isAlreadyLinked(): boolean {
  const existing = findBytebellOnPath();
  if (existing === null) {
    return false;
  }
  try {
    const stat = fs.lstatSync(existing);
    if (stat.isSymbolicLink()) {
      const linkTarget = fs.realpathSync(existing);
      const cliEntry = resolveCliEntry();
      const wrapperPath = path.resolve(path.dirname(cliEntry), "..", "bin", "bytebell");
      return linkTarget === fs.realpathSync(wrapperPath);
    }
    return false;
  } catch {
    return false;
  }
}
export function ensureGlobalLink(): LinkResult {
  const cliEntry = resolveCliEntry();

  if (isAlreadyLinked()) {
    const existing = findBytebellOnPath();
    return { linked: true, target: cliEntry, linkPath: existing ?? "" };
  }

  const wrapperDir = path.resolve(path.dirname(cliEntry), "..", "bin");
  const wrapperPath = path.join(wrapperDir, "bytebell");

  if (!fs.existsSync(wrapperDir)) {
    fs.mkdirSync(wrapperDir, { recursive: true });
  }

  const relEntry = path.relative(wrapperDir, cliEntry);

  fs.writeFileSync(
    wrapperPath,
    `#!/usr/bin/env bun\nimport("${relEntry.startsWith(".") ? relEntry : "./" + relEntry}");\n`,
    { mode: 0o755 },
  );

  const globalBin = findWritableGlobalBin();
  if (globalBin === null) {
    info(`Could not auto-link. Run manually:\n  sudo ln -sf ${wrapperPath} /usr/local/bin/bytebell`);
    return { linked: false, target: cliEntry, linkPath: wrapperPath };
  }

  const linkPath = path.join(globalBin, "bytebell");
  const needsSudo = !isDirWritable(globalBin);

  if (needsSudo) {
    const result = spawnSync("ln", ["-sf", wrapperPath, linkPath], { encoding: "utf8" });
    if (result.status !== 0) {
      const sudoResult = spawnSync("sudo", ["ln", "-sf", wrapperPath, linkPath], {
        stdio: "inherit",
      });
      if (sudoResult.status !== 0) {
        error(`Failed to create symlink at ${linkPath}`);
        info(`Run manually: sudo ln -sf ${wrapperPath} ${linkPath}`);
        return { linked: false, target: cliEntry, linkPath: wrapperPath };
      }
    }
  } else {
    try {
      fs.symlinkSync(wrapperPath, linkPath, "file");
    } catch (e: unknown) {
      if (e instanceof Error && "code" in e && (e as { code: string }).code === "EEXIST") {
        fs.unlinkSync(linkPath);
        fs.symlinkSync(wrapperPath, linkPath, "file");
      } else {
        throw e;
      }
    }
  }

  success(`Linked bytebell → ${linkPath}`);
  return { linked: true, target: cliEntry, linkPath };
}

function findWritableGlobalBin(): string | null {
  for (const dir of GLOBAL_BIN_DIRS) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

function isDirWritable(dirPath: string): boolean {
  try {
    const testFile = path.join(dirPath, ".bytebell-write-test");
    fs.writeFileSync(testFile, "x", { flag: "wx" });
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}
