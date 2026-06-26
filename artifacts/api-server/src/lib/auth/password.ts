import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const KEY_LEN = 64;
const SCHEME = "scrypt";

/**
 * Hash a plaintext password using scrypt with a per-password random salt.
 * Returns a self-describing string: `scrypt$<saltHex>$<hashHex>`.
 *
 * Uses Node's built-in crypto — no native deps, no plaintext ever persisted.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `${SCHEME}$${salt}$${derived.toString("hex")}`;
}

/**
 * Verify a plaintext password against a stored `scrypt$salt$hash` string.
 * Uses a constant-time comparison to avoid timing attacks. Returns false for
 * any malformed stored value rather than throwing.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [scheme, salt, keyHex] = parts;
  if (scheme !== SCHEME || !salt || !keyHex) return false;

  const keyBuf = Buffer.from(keyHex, "hex");
  const derived = (await scryptAsync(password, salt, keyBuf.length)) as Buffer;

  if (keyBuf.length !== derived.length) return false;
  return timingSafeEqual(keyBuf, derived);
}
