// SPDX-License-Identifier: AGPL-3.0-only WITH non-commercial-clause
import { Config } from "@bb/types";
import type { ConfigValue } from "./schema.ts";
import { setSecret, KeychainUnavailableError } from "./keychain.ts";
import { setConfigValue } from "./writer.ts";

/**
 * Secret write helpers that compose keychain storage with the plaintext config
 * writer. Kept separate from `keychain.ts` so the keychain module stays free of
 * any dependency on the config writer/loader (which would form an import cycle).
 */

export type SecretWriteResult = "keychain" | "plaintext";

/**
 * Store a secret in the OS keychain and clear any stale plaintext copy so the
 * keychain value is authoritative. If no keychain backend is available, fall
 * back to a plaintext write in `config.json` and report `"plaintext"` so the
 * caller can warn the user.
 */
export function storeSecret(key: Config, value: string): SecretWriteResult {
  try {
    setSecret(key, value);
    setConfigValue(key, "" as ConfigValue<typeof key>);
    return "keychain";
  } catch (err: unknown) {
    if (err instanceof KeychainUnavailableError) {
      setConfigValue(key, value as ConfigValue<typeof key>);
      return "plaintext";
    }
    throw err;
  }
}
