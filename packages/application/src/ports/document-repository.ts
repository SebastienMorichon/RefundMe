import type { DocumentKind, StoredDocument } from "@lydoc/domain";

export type CreateDocumentInput = Readonly<{
  ownerId: string;
  kind: DocumentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageBucket: string;
  storageKey: string;
  checksumSha256: string;
}>;

export interface DocumentRepository {
  create(input: CreateDocumentInput): Promise<StoredDocument>;
  listByOwner(ownerId: string): Promise<StoredDocument[]>;
}

