import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/** HMAC-SHA256 of `payload` keyed by `secret`, hex-encoded. Used to sign webhook bodies. */
export function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error("ENCRYPTION_KEY not set");
  if (hex.length !== 64) throw new Error("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  return Buffer.from(hex, "hex");
}

export async function encrypt(plain: string): Promise<string> {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export async function decrypt(payload: string): Promise<string> {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const enc = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

const SECRET_TAG = "enc:";

/** Encrypts a stored secret, tagging it so revealSecret can detect ciphertext. */
export async function encryptSecret(plain: string): Promise<string> {
  return SECRET_TAG + (await encrypt(plain));
}

/**
 * Returns the plaintext of a stored secret. Values without the tag are legacy
 * plaintext rows and are returned as-is (write path encrypts going forward).
 */
export async function revealSecret(stored: string): Promise<string> {
  if (!stored.startsWith(SECRET_TAG)) return stored;
  return decrypt(stored.slice(SECRET_TAG.length));
}
