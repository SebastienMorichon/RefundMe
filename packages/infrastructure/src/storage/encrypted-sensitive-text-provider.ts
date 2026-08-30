import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const prefix = "LYDOC-TEXT-2";

/** Field-level encryption for OCR text persisted in PostgreSQL. */
export class EncryptedSensitiveTextProvider {
  constructor(
    private readonly secret = readCurrentSecret(),
    private readonly currentKeyId = readCurrentKeyId(),
    private readonly previousSecrets = readPreviousSecrets(),
  ) {
    assertKeyId(currentKeyId);
    for (const [keyId, previousSecret] of Object.entries(previousSecrets)) {
      assertKeyId(keyId);
      assertSecret(previousSecret);
    }
  }

  encrypt(value: string, context: string): string {
    const iv = randomBytes(12);
    const keyId = Buffer.from(this.currentKeyId, "utf8").toString("base64url");
    const cipher = createCipheriv("aes-256-gcm", deriveKey(this.secret), iv);
    cipher.setAAD(aad(context, keyId));
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      prefix,
      keyId,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }

  decrypt(value: string, context: string): string {
    // Backward-compatible read for records written before field encryption.
    if (!value.startsWith(`${prefix}.`)) return value;
    const parts = value.split(".");
    if (parts.length !== 5) throw invalidEncryptedText();
    const [, encodedKeyId, encodedIv, encodedTag, encodedPayload] = parts;
    if (!encodedKeyId || !encodedIv || !encodedTag || !encodedPayload) {
      throw invalidEncryptedText();
    }
    const keyId = Buffer.from(encodedKeyId, "base64url").toString("utf8");
    assertKeyId(keyId);
    const secret =
      keyId === this.currentKeyId ? this.secret : this.previousSecrets[keyId];
    if (!secret) {
      throw new Error("La cle du texte OCR n'est plus disponible.");
    }
    try {
      const iv = Buffer.from(encodedIv, "base64url");
      const tag = Buffer.from(encodedTag, "base64url");
      const payload = Buffer.from(encodedPayload, "base64url");
      if (iv.length !== 12 || tag.length !== 16 || payload.length < 1) {
        throw invalidEncryptedText();
      }
      const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
      decipher.setAAD(aad(context, encodedKeyId));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(payload),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw invalidEncryptedText();
    }
  }
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256")
    .update("lydoc-sensitive-text-v1\0")
    .update(secret)
    .digest();
}

function aad(context: string, encodedKeyId: string): Buffer {
  return Buffer.from(`${prefix}\0${encodedKeyId}\0${context}`, "utf8");
}

function invalidEncryptedText(): Error {
  return new Error("Le texte OCR chiffre est invalide.");
}

function assertKeyId(value: string): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    throw new Error("DOCUMENT_ENCRYPTION_KEY_ID est invalide.");
  }
}

function assertSecret(value: string): void {
  if (value.length < 32 || value.includes("replace-with")) {
    throw new Error("Un secret historique de chiffrement est invalide.");
  }
}

function readCurrentSecret(): string {
  const localDefault = "local-dev-document-secret-change-me";
  const value = process.env.DOCUMENT_ENCRYPTION_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    (!value ||
      value === localDefault ||
      value.includes("replace-with") ||
      value.length < 32)
  ) {
    throw new Error("DOCUMENT_ENCRYPTION_SECRET must be configured in production.");
  }
  return value ?? localDefault;
}

function readCurrentKeyId(): string {
  return process.env.DOCUMENT_ENCRYPTION_KEY_ID ?? "local-primary";
}

function readPreviousSecrets(): Readonly<Record<string, string>> {
  const configured = process.env.DOCUMENT_ENCRYPTION_PREVIOUS_KEYS;
  if (!configured) return {};
  try {
    const parsed = JSON.parse(configured) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("invalid keyring");
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([, secret]) => typeof secret !== "string")) {
      throw new Error("invalid keyring value");
    }
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    throw new Error("DOCUMENT_ENCRYPTION_PREVIOUS_KEYS doit etre un objet JSON valide.");
  }
}
