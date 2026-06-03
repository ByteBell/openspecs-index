import os from "node:os";
import path from "node:path";

let testHomeOverride: string | null = null;
let homeResolver: (() => string | null) | null = null;
const cacheInvalidators: Array<() => void> = [];

export function getBytebellHome(): string {
  if (testHomeOverride !== null) {
    return testHomeOverride;
  }
  if (homeResolver !== null) {
    const resolved = homeResolver();
    if (resolved !== null) {
      return resolved;
    }
  }
  return path.join(os.homedir(), ".bytebell");
}

/**
 * Register an override resolver for `getBytebellHome()`. The resolver runs on
 * every call (no caching) so it may return different values across invocations.
 * Returning `null` falls through to the `~/.bytebell` default. Pass `null` to
 * clear the resolver.
 */
export function setBytebellHomeResolver(fn: (() => string | null) | null): void {
  homeResolver = fn;
  __notifyConfigChanged();
}

export function getConfigPath(): string {
  return path.join(getBytebellHome(), "config.json");
}

/**
 * Resolve a configured filesystem path to an absolute one. Expands a leading
 * `~` to the OS home, resolves a relative value against the bytebell home, and
 * returns absolute paths unchanged. An empty value stays empty so callers can
 * still detect "not set" — embedded-mode validation relies on this.
 */
export function resolveUnderHome(value: string): string {
  const v = value.trim();
  if (v.length === 0) {
    return "";
  }
  if (v === "~") {
    return os.homedir();
  }
  if (v.startsWith("~/") || v.startsWith("~\\")) {
    return path.join(os.homedir(), v.slice(2));
  }
  if (path.isAbsolute(v)) {
    return v;
  }
  return path.join(getBytebellHome(), v);
}

export function __registerCacheInvalidator(fn: () => void): void {
  cacheInvalidators.push(fn);
}

export function __notifyConfigChanged(): void {
  for (const fn of cacheInvalidators) {
    fn();
  }
}

export function __setBytebellHomeForTests(home: string | null): void {
  testHomeOverride = home;
  __notifyConfigChanged();
}

/**
 * Dev-mode toggle. Enabled by `BYTEBELL_DEV=1` on the shell session.
 *
 * Narrow purpose: redirect log output to the working directory so contributors
 * can tail logs without cd-ing to ~/.bytebell. Does NOT bypass the Rule of Env
 * Vars — no infra URI, credential, or persisted setting is sourced here.
 */
export function isDevMode(): boolean {
  return process.env["BYTEBELL_DEV"] === "1";
}
