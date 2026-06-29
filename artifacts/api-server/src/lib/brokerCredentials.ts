import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const FORMAT_PREFIX = "v1";

export type BrokerCredentialPayload = Record<string, unknown>;

function decodeEncryptionKey(): Buffer {
  const rawKey = process.env["BROKER_TOKEN_ENCRYPTION_KEY"]?.trim();

  if (!rawKey) {
    throw new Error("Broker credential encryption key is not configured.");
  }

  const candidates: Buffer[] = [];

  if (/^[0-9a-f]+$/i.test(rawKey) && rawKey.length === KEY_BYTES * 2) {
    candidates.push(Buffer.from(rawKey, "hex"));
  }

  try {
    candidates.push(Buffer.from(rawKey, "base64"));
  } catch {
    // Ignore malformed base64 and fall back to utf8 validation below.
  }

  candidates.push(Buffer.from(rawKey, "utf8"));

  const key = candidates.find((candidate) => candidate.length === KEY_BYTES);

  if (!key) {
    throw new Error(
      "Broker credential encryption key is invalid. Use 32 raw bytes, 32 base64-decoded bytes, or a 64-character hex key.",
    );
  }

  return key;
}

export function encryptCredentialPayload(payload: BrokerCredentialPayload): string {
  const key = decodeEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_PREFIX,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptCredentialPayload<T extends BrokerCredentialPayload = BrokerCredentialPayload>(
  encryptedPayload: string,
): T {
  const [prefix, ivEncoded, authTagEncoded, ciphertextEncoded] = encryptedPayload.split(":");

  if (prefix !== FORMAT_PREFIX || !ivEncoded || !authTagEncoded || !ciphertextEncoded) {
    throw new Error("Broker credential payload format is invalid.");
  }

  const key = decodeEncryptionKey();
  const iv = Buffer.from(ivEncoded, "base64url");
  const authTag = Buffer.from(authTagEncoded, "base64url");
  const ciphertext = Buffer.from(ciphertextEncoded, "base64url");

  if (iv.length !== IV_BYTES || authTag.length === 0 || ciphertext.length === 0) {
    throw new Error("Broker credential payload is invalid.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  return JSON.parse(plaintext) as T;
}
