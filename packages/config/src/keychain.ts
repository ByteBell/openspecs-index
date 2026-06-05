// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { Entry } from "@napi-rs/keyring";
import { Config } from "@bb/types";
import { __notifyConfigChanged } from "./paths.ts";

/**
 * OS-keychain storage for persisted secrets.
 *
 * Secrets live in the platform credential store (macOS Keychain, Linux Secret
 * Service, Windows Credential Manager) instead of plaintext in `config.json`.
 * The keychain account is the `Config` enum value itself (e.g.
 * `"openrouter_api_key"`), which equals the JSON field name in `config.json`.
 *
 * Every operation is wrapped: an absent or locked backend degrades gracefully
 * (reads return `null`, deletes are best-effort) rather than throwing at the
 * call site — only `setSecret` surfaces a typed error so callers can fall back
 * to a warned plaintext write.
 */

const SERVICE = "bytebell";

/** Config keys whose value is a secret and is stored in the OS keychain. */
export const SECRET_KEYS: ReadonlySet<Config> = new Set([Config.OpenrouterApiKey, Config.Neo4jPassword]);

/** Thrown by {@link setSecret} when no keychain backend can store the value. */
export class KeychainUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("OS keychain is unavailable on this machine");
    this.name = "KeychainUnavailableError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** True when `key` is a secret-bearing config key (kept out of plaintext writes). */
export function isSecretKey(key: Config): boolean {
  return SECRET_KEYS.has(key);
}

function entryFor(key: Config): Entry {
  return new Entry(SERVICE, key);
}

/** Read a secret from the keychain. Returns `null` if absent or the backend is unavailable. */
export function getSecret(key: Config): string | null {
  try {
    return entryFor(key).getPassword();
  } catch {
    return null;
  }
}

/** Store a secret in the keychain. Throws {@link KeychainUnavailableError} if no backend can store it. */
export function setSecret(key: Config, value: string): void {
  try {
    entryFor(key).setPassword(value);
  } catch (cause: unknown) {
    throw new KeychainUnavailableError(cause);
  }
  __notifyConfigChanged();
}

/** Delete a secret from the keychain. Best-effort; never throws. */
export function deleteSecret(key: Config): void {
  try {
    entryFor(key).deletePassword();
  } catch {
    // already absent or backend unavailable — nothing to do
  }
  __notifyConfigChanged();
}

/**
 * Probe whether the OS keychain backend is usable. Read-only (no write, so no
 * GUI prompt on macOS): a missing probe entry returns `null` when the backend
 * is present and throws when it is absent.
 */
export function isKeychainAvailable(): boolean {
  try {
    new Entry(SERVICE, "__availability_probe__").getPassword();
    return true;
  } catch {
    return false;
  }
}
