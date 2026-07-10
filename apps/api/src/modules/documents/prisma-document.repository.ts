import { Injectable } from "@nestjs/common";
import type { CreateDocumentInput, DocumentRepository } from "@lydoc/application";
import type { DocumentKind, DocumentStatus, StoredDocument } from "@lydoc/domain";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateDocumentInput): Promise<StoredDocument> {
    const document = await this.prisma.document.create({
      data: {
        ownerId: input.ownerId,
        kind: input.kind,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageBucket: input.storageBucket,
        storageKey: input.storageKey,
        checksumSha256: input.checksumSha256,
      },
    });

    return this.toDomain(document);
  }

  async listByOwner(ownerId: string): Promise<StoredDocument[]> {
    const documents = await this.prisma.document.findMany({
      where: { ownerId },
      orderBy: { uploadedAt: "desc" },
    });

    return documents.map((document) => this.toDomain(document));
  }

  private toDomain(document: {
    id: string;
    ownerId: string | null;
    kind: DocumentKind;
    status: DocumentStatus;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
    checksumSha256: string;
    encrypted: boolean;
  }): StoredDocument {
    if (!document.encrypted) {
      throw new Error("Stored documents must be encrypted.");
    }

    const storedDocument: StoredDocument = {
      id: document.id,
      kind: document.kind,
      status: document.status,
      originalName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      checksumSha256: document.checksumSha256,
      storageKey: document.storageKey,
      encrypted: true,
    };

    return document.ownerId
      ? { ...storedDocument, ownerId: document.ownerId }
      : storedDocument;
  }
}
