const GREEN = "[32m";
const RED = "[31m";
const RESET = "[0m";

function paint(color: string, line: string, stream: { isTTY?: boolean }): string {
  return stream.isTTY === true ? `${color}${line}${RESET}` : line;
}

export function success(line: string): void {
  process.stdout.write(`${paint(GREEN, `✓ ${line}`, process.stdout)}\n`);
}

export function error(line: string, hint?: string): void {
  process.stderr.write(`${paint(RED, `✗ ${line}`, process.stderr)}\n`);
  if (hint !== undefined && hint.length > 0) {
    process.stderr.write(`  Run: ${hint}\n`);
  }
}

export function list(label: string, items: readonly string[]): void {
  process.stderr.write(`${label}\n`);
  for (const item of items) {
    process.stderr.write(`    ${item}\n`);
  }
}

export interface Spinner {
  update(text: string): void;
  stop(success: boolean, finalMsg?: string): void;
}

export function createSpinner(initialText: string): Spinner {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let text = initialText;
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const render = () => {
    if (process.stderr.isTTY) {
      process.stderr.write(`\r${frames[frameIndex]} ${text}\x1b[K`);
    }
  };

  if (process.stderr.isTTY) {
    timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      render();
    }, 80);
    render();
  } else {
    process.stderr.write(`${text}...\n`);
  }

  return {
    update(newText: string) {
      text = newText;
      if (!process.stderr.isTTY) {
        process.stderr.write(`${text}...\n`);
      } else {
        render();
      }
    },
    stop(isSuccess: boolean, finalMsg?: string) {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (process.stderr.isTTY) {
        process.stderr.write("\r\x1b[K"); // Clear line
        const symbol = isSuccess ? paint(GREEN, "✓", process.stderr) : paint(RED, "✗", process.stderr);
        process.stderr.write(`${symbol} ${finalMsg ?? text}\n`);
      } else if (finalMsg) {
        if (isSuccess) {
          success(finalMsg);
        } else {
          error(finalMsg);
        }
      }
    },
  };
}
export interface ProgressBar {
  update(current: number, total: number, text?: string): void;
  stop(success: boolean, finalMsg?: string): void;
}

export function createProgressBar(initialText: string): ProgressBar {
  let text = initialText;
  let current = 0;
  let total = 0;
  const width = 30;

  const render = () => {
    if (process.stderr.isTTY) {
      const percent = total > 0 ? Math.min(100, (current / total) * 100) : 0;
      const filled = Math.floor((percent / 100) * width);
      const empty = width - filled;
      const bar = "█".repeat(filled) + "░".repeat(empty);
      process.stderr.write(`\r${text} [${bar}] ${percent.toFixed(1)}%\x1b[K`);
    }
  };

  if (process.stderr.isTTY) {
    render();
  } else {
    process.stderr.write(`${text}...\n`);
  }

  return {
    update(newCurrent: number, newTotal: number, newText?: string) {
      current = newCurrent;
      total = newTotal;
      if (newText) {
        text = newText;
      }
      if (!process.stderr.isTTY) {
        process.stderr.write(`${text} ${current}/${total}...\n`);
      } else {
        render();
      }
    },
    stop(isSuccess: boolean, finalMsg?: string) {
      if (process.stderr.isTTY) {
        process.stderr.write("\r\x1b[K"); // Clear line
        const symbol = isSuccess ? paint(GREEN, "✓", process.stderr) : paint(RED, "✗", process.stderr);
        process.stderr.write(`${symbol} ${finalMsg ?? text}\n`);
      } else if (finalMsg) {
        if (isSuccess) {
          success(finalMsg);
        } else {
          error(finalMsg);
        }
      }
    },
  };
}
export function table(headers: string[], rows: string[][]): void {
  if (!rows || rows.length === 0) {
    process.stdout.write(headers.join("  ") + "\n");
    return;
  }
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)));
  const writeRow = (cols: string[]): void => {
    process.stdout.write(cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ") + "\n");
  };
  writeRow(headers);
  for (const row of rows) {
    writeRow(row);
  }
}

export function info(line: string): void {
  process.stdout.write(`${line}\n`);
}
