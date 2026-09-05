import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ObjectStorageProvider,
  PutObjectInput,
  StoredObjectRef,
} from "@lydoc/application";

export class DocumentStorageCapacityError extends Error {
  constructor() {
    super("Le stockage documentaire approche de sa capacite maximale.");
    this.name = "DocumentStorageCapacityError";
  }
}

export class LocalEncryptedObjectStorageProvider implements ObjectStorageProvider {
  constructor(
    private readonly rootDirectory: string,
    private readonly bucket = "local-documents",
    private readonly secret = readDocumentEncryptionSecret(),
    private readonly currentKeyId = readCurrentKeyId(),
    private readonly previousSecrets = readPreviousEncryptionSecrets(),
    private readonly minimumFreeBytes = readMinimumFreeBytes(),
  ) {
    assertValidKeyId(currentKeyId);
    for (const [keyId, previousSecret] of Object.entries(previousSecrets)) {
      assertValidKeyId(keyId);
      assertValidSecret(previousSecret, `previous key ${keyId}`);
    }
  }

  async putEncryptedObject(input: PutObjectInput): Promise<StoredObjectRef> {
    const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.bin`;
    const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
    const encryptedPayload = this.encrypt(input.bytes, input.encryptionContext);
    const destination = this.resolveObjectPath(this.bucket, key);

    await mkdir(this.rootDirectory, { recursive: true });
    const filesystem = await statfs(this.rootDirectory);
    const availableBytes = BigInt(filesystem.bavail) * BigInt(filesystem.bsize);
    if (
      availableBytes - BigInt(encryptedPayload.byteLength) <
      BigInt(this.minimumFreeBytes)
    ) {
      throw new DocumentStorageCapacityError();
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, encryptedPayload, { flag: "wx", mode: 0o600 });

    return {
      bucket: this.bucket,
      key,
      checksumSha256,
      sizeBytes: input.bytes.byteLength,
    };
  }

  async getSignedReadUrl(input: StoredObjectRef, ttlSeconds: number): Promise<string> {
    void input;
    void ttlSeconds;
    throw new Error("Local signed read URLs are not available in this iteration.");
  }

  async getDecryptedObject(input: {
    object: StoredObjectRef;
    encryptionContext: Record<string, string>;
  }): Promise<Uint8Array> {
    const encryptedPayload = await readFile(
      this.resolveObjectPath(input.object.bucket, input.object.key),
    );

    return this.decrypt(encryptedPayload, input.encryptionContext);
  }

  async deleteObject(input: StoredObjectRef): Promise<void> {
    await rm(this.resolveObjectPath(input.bucket, input.key), { force: true });
  }

  private encrypt(bytes: Uint8Array, context: Record<string, string>): Buffer {
    const iv = randomBytes(12);
    const keyId = Buffer.from(this.currentKeyId, "utf8");
    const prefix = Buffer.concat([
      Buffer.from("LYDOC2"),
      Buffer.from([keyId.byteLength]),
      keyId,
      iv,
    ]);
    const cipher = createCipheriv("aes-256-gcm", deriveKey(this.secret), iv);
    cipher.setAAD(Buffer.concat([prefix, serializeContext(context)]));

    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([prefix, tag, encrypted]);
  }

  private decrypt(payload: Buffer, context: Record<string, string>): Buffer {
    const header = payload.subarray(0, 6).toString("utf8");
    if (header === "LYDOC2") {
      return this.decryptVersion2(payload, context);
    }
    if (header === "LYDOC1") {
      return this.decryptLegacy(payload, context);
    }
    throw new Error("Le document chiffre est invalide.");
  }

  private decryptVersion2(
    payload: Buffer,
    context: Record<string, string>,
  ): Buffer {
    const keyIdLength = payload[6] ?? 0;
    const ivOffset = 7 + keyIdLength;
    const tagOffset = ivOffset + 12;
    const encryptedOffset = tagOffset + 16;
    if (keyIdLength < 1 || payload.length <= encryptedOffset) {
      throw new Error("Le document chiffre est invalide.");
    }

    const keyId = payload.subarray(7, ivOffset).toString("utf8");
    assertValidKeyId(keyId);
    const secret =
      keyId === this.currentKeyId ? this.secret : this.previousSecrets[keyId];
    if (!secret) {
      throw new Error("La cle de chiffrement de ce document n'est plus disponible.");
    }

    const prefix = payload.subarray(0, tagOffset);
    const iv = payload.subarray(ivOffset, tagOffset);
    const tag = payload.subarray(tagOffset, encryptedOffset);
    const encrypted = payload.subarray(encryptedOffset);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAAD(Buffer.concat([prefix, serializeContext(context)]));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  private decryptLegacy(
    payload: Buffer,
    context: Record<string, string>,
  ): Buffer {
    const headerLength = 6;
    const ivLength = 12;
    const tagLength = 16;

    if (payload.length <= headerLength + ivLength + tagLength) {
      throw new Error("Le document chiffre est invalide.");
    }

    const iv = payload.subarray(headerLength, headerLength + ivLength);
    const tag = payload.subarray(headerLength + ivLength, headerLength + ivLength + tagLength);
    const encrypted = payload.subarray(headerLength + ivLength + tagLength);
    const secrets = [...new Set([this.secret, ...Object.values(this.previousSecrets)])];
    for (const secret of secrets) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
        decipher.setAAD(Buffer.from(JSON.stringify(context), "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]);
      } catch {
        // LYDOC1 did not carry a key ID, so every retained key must be tried.
      }
    }
    throw new Error("Le document chiffre est invalide ou sa cle n'est plus disponible.");
  }

  private resolveObjectPath(bucket: string, key: string): string {
    if (bucket !== this.bucket || !/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.bin$/i.test(key)) {
      throw new Error("La reference de stockage est invalide.");
    }
    const root = resolve(this.rootDirectory);
    const candidate = resolve(root, bucket, key);
    const pathFromRoot = relative(root, candidate);
    if (
      pathFromRoot.length === 0 ||
      pathFromRoot.startsWith(`..${sep}`) ||
      pathFromRoot === ".." ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error("La reference de stockage sort du repertoire autorise.");
    }
    return candidate;
  }
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function serializeContext(context: Record<string, string>): Buffer {
  return Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(context).sort(([left], [right]) => left.localeCompare(right)),
      ),
    ),
    "utf8",
  );
}

function assertValidKeyId(keyId: string): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
    throw new Error("DOCUMENT_ENCRYPTION_KEY_ID est invalide.");
  }
}

function assertValidSecret(secret: string, label: string): void {
  if (secret.length < 32 || secret.includes("replace-with")) {
    throw new Error(`Le secret de chiffrement ${label} est invalide.`);
  }
}

function readDocumentEncryptionSecret(): string {
  const localDefault = "local-dev-document-secret-change-me";
  const configuredSecret = process.env.DOCUMENT_ENCRYPTION_SECRET;

  if (
    process.env.NODE_ENV === "production" &&
    (!configuredSecret || configuredSecret === localDefault || configuredSecret.includes("replace-with") || configuredSecret.length < 32)
  ) {
    throw new Error("DOCUMENT_ENCRYPTION_SECRET must be configured in production.");
  }

  return configuredSecret ?? localDefault;
}

function readCurrentKeyId(): string {
  return process.env.DOCUMENT_ENCRYPTION_KEY_ID ?? "local-primary";
}

function readPreviousEncryptionSecrets(): Readonly<Record<string, string>> {
  const configured = process.env.DOCUMENT_ENCRYPTION_PREVIOUS_KEYS;
  if (!configured) return {};
  try {
    const parsed = JSON.parse(configured) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("not an object");
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([, value]) => typeof value !== "string")) {
      throw new Error("invalid secret value");
    }
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    throw new Error("DOCUMENT_ENCRYPTION_PREVIOUS_KEYS doit etre un objet JSON valide.");
  }
}

function readMinimumFreeBytes(): number {
  const configured = Number(process.env.DOCUMENT_STORAGE_MIN_FREE_BYTES);
  if (
    Number.isSafeInteger(configured) &&
    configured >= 0 &&
    configured <= 100_000_000_000_000
  ) {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? 1_073_741_824 : 0;
}
