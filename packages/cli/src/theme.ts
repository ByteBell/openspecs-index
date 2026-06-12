/**
 * Bytebell brand accent — cyan. Single source of truth for the TUI accent
 * used by cursors, active rows, form highlights, and the control-key caps.
 * Using the named ANSI colour so it renders consistently across terminals.
 */
export const ACCENT = "cyan";

/**
 * Raw ANSI escapes for the non-Ink output path (`output.ts` spinners,
 * tables, progress bars). Kept here so every command — Ink or plain stdout —
 * draws from one palette. `accent` is the ANSI form of {@link ACCENT}.
 */
export const ANSI = {
  accent: "\x1b[36m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
} as const;
