import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ObjectStorageProvider,
  PutObjectInput,
  StoredObjectRef,
} from "@lydoc/application";

export class LocalEncryptedObjectStorageProvider implements ObjectStorageProvider {
  constructor(
    private readonly rootDirectory: string,
    private readonly bucket = "local-documents",
    private readonly secret = readDocumentEncryptionSecret(),
  ) {}

  async putEncryptedObject(input: PutObjectInput): Promise<StoredObjectRef> {
    const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.bin`;
    const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
    const encryptedPayload = this.encrypt(input.bytes, input.encryptionContext);
    const destination = join(this.rootDirectory, this.bucket, key);

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, encryptedPayload);

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
      join(this.rootDirectory, input.object.bucket, input.object.key),
    );

    return this.decrypt(encryptedPayload, input.encryptionContext);
  }

  async deleteObject(input: StoredObjectRef): Promise<void> {
    await rm(join(this.rootDirectory, input.bucket, input.key), { force: true });
  }

  private encrypt(bytes: Uint8Array, context: Record<string, string>): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.deriveKey(), iv);
    cipher.setAAD(Buffer.from(JSON.stringify(context), "utf8"));

    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([Buffer.from("LYDOC1"), iv, tag, encrypted]);
  }

  private deriveKey(): Buffer {
    return createHash("sha256").update(this.secret).digest();
  }

  private decrypt(payload: Buffer, context: Record<string, string>): Buffer {
    const headerLength = 6;
    const ivLength = 12;
    const tagLength = 16;

    if (payload.length <= headerLength + ivLength + tagLength || payload.subarray(0, headerLength).toString("utf8") !== "LYDOC1") {
      throw new Error("Le document chiffre est invalide.");
    }

    const iv = payload.subarray(headerLength, headerLength + ivLength);
    const tag = payload.subarray(headerLength + ivLength, headerLength + ivLength + tagLength);
    const encrypted = payload.subarray(headerLength + ivLength + tagLength);
    const decipher = createDecipheriv("aes-256-gcm", this.deriveKey(), iv);
    decipher.setAAD(Buffer.from(JSON.stringify(context), "utf8"));
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
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
