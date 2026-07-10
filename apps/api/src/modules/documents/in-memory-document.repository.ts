import { Injectable } from "@nestjs/common";
import type { CreateDocumentInput, DocumentRepository } from "@lydoc/application";
import type { StoredDocument } from "@lydoc/domain";

@Injectable()
export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly documents = new Map<string, StoredDocument>();

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
    };

    this.documents.set(document.id, document);
    return document;
  }

  async listByOwner(ownerId: string): Promise<StoredDocument[]> {
    return Array.from(this.documents.values()).filter((document) => document.ownerId === ownerId);
  }
}
