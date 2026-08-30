import { Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const envelopeVersion = "v1";
const keyIdPattern = /^[A-Za-z0-9_-]{1,48}$/;
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

@Injectable()
export class MfaSecretService {
  private readonly keyring = readMfaKeyring();

  generateSecret(): string {
    return encodeBase32(randomBytes(20));
  }

  encrypt(userId: string, secret: string): string {
    const iv = randomBytes(12);
    const key = deriveKey(this.keyring.current.secret);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(envelopeAad(userId, this.keyring.current.id));
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      envelopeVersion,
      this.keyring.current.id,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(userId: string, envelope: string): string {
    const [version, keyId, encodedIv, encodedTag, encodedCiphertext] =
      envelope.split(".");
    if (
      version !== envelopeVersion ||
      !keyId ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext
    ) {
      throw new Error("Invalid MFA secret envelope.");
    }
    const secret = this.keyring.keys.get(keyId);
    if (!secret) throw new Error("Unknown MFA encryption key.");
    const iv = decodeCanonicalBase64Url(encodedIv, 12);
    const tag = decodeCanonicalBase64Url(encodedTag, 16);
    const ciphertext = decodeCanonicalBase64Url(encodedCiphertext);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAAD(envelopeAad(userId, keyId));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }

  provisioningUri(email: string, secret: string): string {
    const label = `Lydoc:${email}`;
    const uri = new URL(`otpauth://totp/${encodeURIComponent(label)}`);
    uri.searchParams.set("secret", secret);
    uri.searchParams.set("issuer", "Lydoc");
    uri.searchParams.set("algorithm", "SHA1");
    uri.searchParams.set("digits", "6");
    uri.searchParams.set("period", "30");
    return uri.toString();
  }
}

export function decodeBase32(value: string): Buffer {
  const normalized = value.replace(/=+$/g, "").toUpperCase();
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("Invalid base32 MFA secret.");
  }
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = base32Alphabet.indexOf(character);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function encodeBase32(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += base32Alphabet[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) output += base32Alphabet[(accumulator << (5 - bits)) & 31];
  return output;
}

function readMfaKeyring(): {
  current: { id: string; secret: string };
  keys: Map<string, string>;
} {
  const production = process.env.NODE_ENV === "production";
  const id =
    process.env.MFA_ENCRYPTION_KEY_ID?.trim() || "local-development-mfa";
  const secret =
    process.env.MFA_ENCRYPTION_SECRET ??
    "local-development-mfa-secret-change-me";
  if (!keyIdPattern.test(id)) {
    throw new Error("MFA_ENCRYPTION_KEY_ID is invalid.");
  }
  if (
    production &&
    (secret.length < 32 ||
      /change[_-]?me|replace-with/i.test(secret) ||
      secret === process.env.SESSION_SECRET ||
      secret === process.env.DOCUMENT_ENCRYPTION_SECRET ||
      secret === process.env.BACKUP_ENCRYPTION_SECRET)
  ) {
    throw new Error(
      "MFA_ENCRYPTION_SECRET must be a dedicated production secret.",
    );
  }

  const keys = new Map<string, string>([[id, secret]]);
  const rawPrevious = process.env.MFA_ENCRYPTION_PREVIOUS_KEYS?.trim() || "{}";
  let previous: unknown;
  try {
    previous = JSON.parse(rawPrevious);
  } catch {
    throw new Error("MFA_ENCRYPTION_PREVIOUS_KEYS must be valid JSON.");
  }
  if (!isPlainRecord(previous)) {
    throw new Error("MFA_ENCRYPTION_PREVIOUS_KEYS must be a JSON object.");
  }
  for (const [previousId, previousSecret] of Object.entries(previous)) {
    if (
      !keyIdPattern.test(previousId) ||
      previousId === id ||
      typeof previousSecret !== "string" ||
      previousSecret.length < 32
    ) {
      throw new Error("MFA_ENCRYPTION_PREVIOUS_KEYS contains an invalid key.");
    }
    keys.set(previousId, previousSecret);
  }
  return { current: { id, secret }, keys };
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256")
    .update("lydoc-admin-mfa-encryption-v1\0")
    .update(secret)
    .digest();
}

function envelopeAad(userId: string, keyId: string): Buffer {
  return Buffer.from(`lydoc-admin-mfa:v1:${userId}:${keyId}`, "utf8");
}

function decodeCanonicalBase64Url(value: string, length?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid MFA secret envelope encoding.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (length !== undefined && decoded.length !== length)
  ) {
    throw new Error("Invalid MFA secret envelope encoding.");
  }
  return decoded;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
}
