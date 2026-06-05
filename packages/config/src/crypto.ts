import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = "bytebell-config-encryption-v1";

/**
 * Derives an encryption key from machine-specific identifiers.
 * This ensures encrypted config is tied to this machine.
 */
function deriveKey(): Buffer {
  // Use machine-specific values that are stable but not easily portable
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const platform = os.platform();
  // Combine with a fixed salt for consistency
  const material = `${hostname}:${username}:${platform}:${SALT}`;
  return crypto.scryptSync(material, SALT, 32);
}

/**
 * Encrypts a string value using AES-256-GCM.
 * Returns a prefixed string so we can detect encrypted values.
 */
export function encryptValue(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  // Format: enc:iv:authTag:ciphertext (all hex-encoded)
  return `enc:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a value encrypted with encryptValue().
 * Returns the plaintext string.
 */
export function decryptValue(encryptedValue: string): string {
  if (!encryptedValue || !encryptedValue.startsWith("enc:")) {
    // Not encrypted — return as-is (backward compatibility)
    return encryptedValue;
  }

  const parts = encryptedValue.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted value format");
  }

  const [, ivHex, authTagHex, ciphertext] = parts;
  const key = deriveKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Encrypts sensitive fields in a config object.
 * Returns a new object with encrypted values.
 */
export function encryptSensitiveFields(config: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = [
    "openrouter_api_key",
    "neo4j_password",
    // Add other sensitive fields here
  ];

  const result = { ...config };
  for (const key of SENSITIVE_KEYS) {
    if (typeof result[key] === "string" && result[key] && !String(result[key]).startsWith("enc:")) {
      result[key] = encryptValue(String(result[key]));
    }
  }
  return result;
}

/**
 * Decrypts sensitive fields in a config object.
 * Returns a new object with decrypted values.
 */
export function decryptSensitiveFields(config: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = [
    "openrouter_api_key",
    "neo4j_password",
  ];

  const result = { ...config };
  for (const key of SENSITIVE_KEYS) {
    if (typeof result[key] === "string" && String(result[key]).startsWith("enc:")) {
      try {
        result[key] = decryptValue(String(result[key]));
      } catch {
        // If decryption fails, keep the value as-is
        // This handles cases where the machine key changed
      }
    }
  }
  return result;
}
