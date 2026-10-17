import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Parse ERP_SECRET_KEY: 32 random bytes as 64 hex characters or base64.
 * Generate one with: openssl rand -hex 32
 */
export function parseSecretKey(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("ERP_SECRET_KEY debe tener 32 bytes (64 caracteres hex); genera uno con: openssl rand -hex 32");
  return key;
}

/** AES-256-GCM; output is iv (12) | tag (16) | ciphertext. */
export function encrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(key: Buffer, data: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}
