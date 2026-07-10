import type { DocumentKind, StoredDocument } from "@lydoc/domain";
import type { DocumentRepository } from "../../ports/document-repository";
import type { ObjectStorageProvider } from "../../ports/object-storage-provider";

const allowedMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg"]);
const maxDocumentSizeBytes = 20 * 1024 * 1024;
const pdfSignature = Buffer.from("%PDF-");
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class UploadUserDocument {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly storage: ObjectStorageProvider,
  ) {}

  async execute(input: {
    ownerId: string;
    kind: DocumentKind;
    originalName: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<StoredDocument> {
    if (!allowedMimeTypes.has(input.mimeType)) {
      throw new Error("Format non accepte. Utilisez PDF, PNG ou JPG.");
    }

    if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxDocumentSizeBytes) {
      throw new Error("Le document doit faire entre 1 octet et 20 Mo.");
    }

    if (!hasExpectedFileSignature(input.bytes, input.mimeType)) {
      throw new Error("Le contenu du document ne correspond pas au format declare.");
    }

    const storedObject = await this.storage.putEncryptedObject({
      bytes: input.bytes,
      originalName: input.originalName,
      mimeType: input.mimeType,
      encryptionContext: {
        ownerId: input.ownerId,
        documentKind: input.kind,
      },
    });

    try {
      return await this.documents.create({
        ownerId: input.ownerId,
        kind: input.kind,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: storedObject.sizeBytes,
        storageBucket: storedObject.bucket,
        storageKey: storedObject.key,
        checksumSha256: storedObject.checksumSha256,
      });
    } catch (error) {
      await this.storage.deleteObject(storedObject).catch(() => undefined);
      throw error;
    }
  }
}

function hasExpectedFileSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "application/pdf") {
    return indexOf(bytes, pdfSignature, 1024) !== -1;
  }

  if (mimeType === "image/png") {
    return startsWith(bytes, pngSignature);
  }

  return mimeType === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function indexOf(bytes: Uint8Array, signature: Uint8Array, limit: number): number {
  const lastStart = Math.min(bytes.length - signature.length, limit);

  for (let index = 0; index <= lastStart; index += 1) {
    if (signature.every((byte, offset) => bytes[index + offset] === byte)) {
      return index;
    }
  }

  return -1;
}
