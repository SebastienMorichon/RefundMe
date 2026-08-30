import type { DocumentKind, StoredDocument } from "@lydoc/domain";
import type { StoredObjectRef } from "./object-storage-provider";

export type CreateDocumentInput = Readonly<{
  ownerId: string;
  kind: DocumentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageBucket: string;
  storageKey: string;
  checksumSha256: string;
  watermarked: boolean;
  watermarkVersion: string | null;
  watermarkReference: string | null;
  watermarkedAt: Date | null;
}>;

export interface DocumentRepository {
  create(input: CreateDocumentInput): Promise<StoredDocument>;
  createWithinOwnerLimits?(
    input: CreateDocumentInput,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
    reservationId?: string,
  ): Promise<StoredDocument | null>;
  reserveOwnerUpload?(
    ownerId: string,
    sizeBytes: number,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
  ): Promise<string | null>;
  resizeOwnerUploadReservation?(
    reservationId: string,
    ownerId: string,
    sizeBytes: number,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
  ): Promise<boolean>;
  recordOwnerUploadStoredObject?(
    reservationId: string,
    ownerId: string,
    object: StoredObjectRef,
  ): Promise<void>;
  releaseOwnerUpload?(reservationId: string, ownerId: string): Promise<void>;
  listByOwner(ownerId: string): Promise<StoredDocument[]>;
}
