import { Injectable } from "@nestjs/common";
import type {
  CreateDocumentInput,
  DocumentRepository,
} from "@lydoc/application";
import type { StoredDocument } from "@lydoc/domain";

@Injectable()
export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly documents = new Map<string, StoredDocument>();
  private readonly reservations = new Map<
    string,
    { ownerId: string; sizeBytes: number; expiresAt: number }
  >();

  async create(input: CreateDocumentInput): Promise<StoredDocument> {
    const document: StoredDocument = {
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      kind: input.kind,
      status: "UPLOADED",
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageBucket: input.storageBucket,
      checksumSha256: input.checksumSha256,
      storageKey: input.storageKey,
      encrypted: true,
      watermarked: input.watermarked,
      ...(input.watermarkVersion
        ? { watermarkVersion: input.watermarkVersion }
        : {}),
      ...(input.watermarkReference
        ? { watermarkReference: input.watermarkReference }
        : {}),
      ...(input.watermarkedAt ? { watermarkedAt: input.watermarkedAt } : {}),
    };

    this.documents.set(document.id, document);
    return document;
  }

  async createWithinOwnerLimits(
    input: CreateDocumentInput,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
    reservationId?: string,
  ): Promise<StoredDocument | null> {
    const documents = Array.from(this.documents.values()).filter(
      (document) => document.ownerId === input.ownerId,
    );
    const storedBytes = documents.reduce(
      (total, document) => total + document.sizeBytes,
      0,
    );
    const reservations = this.activeReservations(input.ownerId).filter(
      ([id]) => id !== reservationId,
    );
    const reservedBytes = reservations.reduce(
      (total, [, reservation]) => total + reservation.sizeBytes,
      0,
    );
    if (
      documents.length + reservations.length + 1 > limits.maxDocuments ||
      storedBytes + reservedBytes + input.sizeBytes > limits.maxStoredBytes
    ) {
      return null;
    }
    return this.create(input);
  }

  async reserveOwnerUpload(
    ownerId: string,
    sizeBytes: number,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
  ): Promise<string | null> {
    const documents = Array.from(this.documents.values()).filter(
      (document) => document.ownerId === ownerId,
    );
    const reservations = this.activeReservations(ownerId);
    const usedBytes = documents.reduce(
      (total, document) => total + document.sizeBytes,
      reservations.reduce(
        (total, [, reservation]) => total + reservation.sizeBytes,
        0,
      ),
    );
    if (
      documents.length + reservations.length + 1 > limits.maxDocuments ||
      usedBytes + sizeBytes > limits.maxStoredBytes
    ) {
      return null;
    }
    const id = crypto.randomUUID();
    this.reservations.set(id, {
      ownerId,
      sizeBytes,
      expiresAt: Date.now() + 15 * 60_000,
    });
    return id;
  }

  async releaseOwnerUpload(
    reservationId: string,
    ownerId: string,
  ): Promise<void> {
    if (this.reservations.get(reservationId)?.ownerId === ownerId) {
      this.reservations.delete(reservationId);
    }
  }

  async resizeOwnerUploadReservation(
    reservationId: string,
    ownerId: string,
    sizeBytes: number,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
  ): Promise<boolean> {
    const reservation = this.reservations.get(reservationId);
    if (
      !reservation ||
      reservation.ownerId !== ownerId ||
      reservation.expiresAt <= Date.now()
    ) {
      this.reservations.delete(reservationId);
      return false;
    }
    const documents = Array.from(this.documents.values()).filter(
      (document) => document.ownerId === ownerId,
    );
    const otherReservations = this.activeReservations(ownerId).filter(
      ([id]) => id !== reservationId,
    );
    const usedBytes = documents.reduce(
      (total, document) => total + document.sizeBytes,
      otherReservations.reduce(
        (total, [, activeReservation]) => total + activeReservation.sizeBytes,
        0,
      ),
    );
    if (
      documents.length + otherReservations.length + 1 > limits.maxDocuments ||
      usedBytes + sizeBytes > limits.maxStoredBytes
    ) {
      return false;
    }
    this.reservations.set(reservationId, {
      ownerId,
      sizeBytes,
      expiresAt: Date.now() + 15 * 60_000,
    });
    return true;
  }

  async recordOwnerUploadStoredObject(): Promise<void> {}

  async listByOwner(ownerId: string): Promise<StoredDocument[]> {
    return Array.from(this.documents.values()).filter(
      (document) => document.ownerId === ownerId,
    );
  }

  private activeReservations(
    ownerId: string,
  ): Array<
    [string, { ownerId: string; sizeBytes: number; expiresAt: number }]
  > {
    const now = Date.now();
    for (const [id, reservation] of this.reservations) {
      if (reservation.expiresAt <= now) this.reservations.delete(id);
    }
    return Array.from(this.reservations.entries()).filter(
      ([, reservation]) => reservation.ownerId === ownerId,
    );
  }
}
