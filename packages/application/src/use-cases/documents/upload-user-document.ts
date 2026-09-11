import type { DocumentKind, StoredDocument } from "@lydoc/domain";
import type { DocumentRepository } from "../../ports/document-repository";
import type { DocumentSecurityScanner } from "../../ports/document-security-scanner";
import type {
  DocumentWatermarkProvider,
  WatermarkedDocument,
} from "../../ports/document-watermark-provider";
import type {
  ObjectStorageProvider,
  StoredObjectRef,
} from "../../ports/object-storage-provider";

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
const maxDocumentSizeBytes = 20 * 1024 * 1024;
const maxOriginalNameLength = 180;
const pdfSignature = Buffer.from("%PDF-");
const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const sensitiveDocumentKinds = new Set<DocumentKind>([
  "IDENTITY_DOCUMENT",
  "BANK_DETAILS",
]);

export class UploadUserDocument {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly storage: ObjectStorageProvider,
    private readonly watermarker: DocumentWatermarkProvider,
    private readonly securityScanner: DocumentSecurityScanner,
    private readonly accountLimits?: Readonly<{
      maxDocuments: number;
      maxStoredBytes: number;
    }>,
    private readonly documentProtection: Readonly<{
      watermarkSensitiveDocuments: boolean;
    }> = { watermarkSensitiveDocuments: true },
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

    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > maxDocumentSizeBytes
    ) {
      throw new Error("Le document doit faire entre 1 octet et 20 Mo.");
    }

    if (!hasExpectedFileSignature(input.bytes, input.mimeType)) {
      throw new Error(
        "Le contenu du document ne correspond pas au format declare.",
      );
    }

    const originalName = normalizeOriginalName(
      input.originalName,
      input.mimeType,
    );
    const reservationId =
      this.accountLimits && this.documents.reserveOwnerUpload
        ? await this.documents.reserveOwnerUpload(
            input.ownerId,
            input.bytes.byteLength,
            this.accountLimits,
          )
        : null;
    if (
      this.accountLimits &&
      this.documents.reserveOwnerUpload &&
      !reservationId
    ) {
      throw accountQuotaError();
    }

    let storedObject: StoredObjectRef | null = null;
    try {
      const currentDocuments = this.accountLimits
        ? await this.documents.listByOwner(input.ownerId)
        : [];
      if (!reservationId) {
        this.assertWithinAccountLimits(
          currentDocuments,
          input.bytes.byteLength,
        );
      }

      const sanitizedBytes = await this.securityScanner.sanitize({
        bytes: input.bytes,
        mimeType: input.mimeType,
      });
      if (
        sanitizedBytes.byteLength === 0 ||
        sanitizedBytes.byteLength > maxDocumentSizeBytes ||
        !hasExpectedFileSignature(sanitizedBytes, input.mimeType)
      ) {
        throw new Error("Le document assaini est invalide ou trop volumineux.");
      }
      if (!reservationId) {
        this.assertWithinAccountLimits(
          currentDocuments,
          sanitizedBytes.byteLength,
        );
      }

      const watermarkedDocument =
        this.documentProtection.watermarkSensitiveDocuments &&
        sensitiveDocumentKinds.has(input.kind)
          ? await this.watermarker.watermark({
              bytes: sanitizedBytes,
              mimeType: input.mimeType,
              kind: input.kind,
            })
          : null;
      const bytesToStore = watermarkedDocument?.bytes ?? sanitizedBytes;

      if (
        bytesToStore.byteLength === 0 ||
        bytesToStore.byteLength > maxDocumentSizeBytes ||
        !hasExpectedFileSignature(bytesToStore, input.mimeType)
      ) {
        throw new Error(
          "La préparation a produit un document invalide ou trop volumineux.",
        );
      }
      if (!reservationId) {
        this.assertWithinAccountLimits(
          currentDocuments,
          bytesToStore.byteLength,
        );
      }

      if (
        reservationId &&
        this.accountLimits &&
        this.documents.resizeOwnerUploadReservation
      ) {
        const resized = await this.documents.resizeOwnerUploadReservation(
          reservationId,
          input.ownerId,
          bytesToStore.byteLength,
          this.accountLimits,
        );
        if (!resized) throw accountQuotaError();
      }

      storedObject = await this.storage.putEncryptedObject({
        bytes: bytesToStore,
        originalName,
        mimeType: input.mimeType,
        encryptionContext: {
          ownerId: input.ownerId,
          documentKind: input.kind,
        },
      });

      try {
        if (reservationId && this.documents.recordOwnerUploadStoredObject) {
          await this.documents.recordOwnerUploadStoredObject(
            reservationId,
            input.ownerId,
            storedObject,
          );
        }
        const createInput = {
          ownerId: input.ownerId,
          kind: input.kind,
          originalName,
          mimeType: input.mimeType,
          sizeBytes: storedObject.sizeBytes,
          storageBucket: storedObject.bucket,
          storageKey: storedObject.key,
          checksumSha256: storedObject.checksumSha256,
          ...watermarkMetadata(watermarkedDocument),
        };
        const document =
          this.accountLimits && this.documents.createWithinOwnerLimits
            ? await this.documents.createWithinOwnerLimits(
                createInput,
                this.accountLimits,
                reservationId ?? undefined,
              )
            : await this.documents.create(createInput);
        if (!document) throw accountQuotaError();
        if (reservationId && this.documents.releaseOwnerUpload) {
          await this.documents
            .releaseOwnerUpload(reservationId, input.ownerId)
            .catch(() => undefined);
        }
        return document;
      } catch (error) {
        let objectDeleted = false;
        try {
          await this.storage.deleteObject(storedObject);
          objectDeleted = true;
        } catch {
          // If the staging reference was already recorded, its durable lease
          // is intentionally retained for the reconciliation worker.
          if (reservationId && this.documents.recordOwnerUploadStoredObject) {
            await this.documents
              .recordOwnerUploadStoredObject(
                reservationId,
                input.ownerId,
                storedObject,
              )
              .catch(() => undefined);
          }
        }
        if (
          objectDeleted &&
          reservationId &&
          this.documents.releaseOwnerUpload
        ) {
          await this.documents
            .releaseOwnerUpload(reservationId, input.ownerId)
            .catch(() => undefined);
        }
        throw error;
      }
    } finally {
      // Before putEncryptedObject there is no orphan to reconcile, so the
      // lease can be released normally. Once an object exists, only a
      // successful persistence commit or confirmed physical deletion may
      // release it.
      if (!storedObject && reservationId && this.documents.releaseOwnerUpload) {
        await this.documents
          .releaseOwnerUpload(reservationId, input.ownerId)
          .catch(() => undefined);
      }
    }
  }

  private assertWithinAccountLimits(
    currentDocuments: StoredDocument[],
    incomingBytes: number,
  ): void {
    if (!this.accountLimits) return;
    const storedBytes = currentDocuments.reduce(
      (total, document) => total + document.sizeBytes,
      0,
    );
    if (
      currentDocuments.length >= this.accountLimits.maxDocuments ||
      storedBytes + incomingBytes > this.accountLimits.maxStoredBytes
    ) {
      throw accountQuotaError();
    }
  }
}

function accountQuotaError(): Error {
  return new Error(
    "Le quota de documents de ce compte est atteint. Supprimez un document avant de reessayer.",
  );
}

function watermarkMetadata(document: WatermarkedDocument | null): {
  watermarked: boolean;
  watermarkVersion: string | null;
  watermarkReference: string | null;
  watermarkedAt: Date | null;
} {
  return document
    ? {
        watermarked: true,
        watermarkVersion: document.version,
        watermarkReference: document.reference,
        watermarkedAt: document.watermarkedAt,
      }
    : {
        watermarked: false,
        watermarkVersion: null,
        watermarkReference: null,
        watermarkedAt: null,
      };
}

function hasExpectedFileSignature(
  bytes: Uint8Array,
  mimeType: string,
): boolean {
  if (mimeType === "application/pdf") {
    return startsWith(bytes, pdfSignature);
  }

  if (mimeType === "image/png") {
    return startsWith(bytes, pngSignature);
  }

  return (
    mimeType === "image/jpeg" &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function normalizeOriginalName(originalName: string, mimeType: string): string {
  const normalized = originalName
    .normalize("NFKC")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > maxOriginalNameLength) {
    throw new Error(
      `Le nom du document doit contenir entre 1 et ${maxOriginalNameLength} caracteres.`,
    );
  }

  const expectedExtension =
    mimeType === "application/pdf"
      ? ".pdf"
      : mimeType === "image/png"
        ? ".png"
        : ".jpg";
  const lowerName = normalized.toLowerCase();
  const acceptedExtensions =
    mimeType === "image/jpeg" ? [".jpg", ".jpeg"] : [expectedExtension];
  if (!acceptedExtensions.some((extension) => lowerName.endsWith(extension))) {
    throw new Error("L'extension du fichier ne correspond pas a son format.");
  }

  return normalized;
}

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}
