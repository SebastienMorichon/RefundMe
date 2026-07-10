import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { UploadUserDocument, type DocumentRepository } from "@lydoc/application";
import { documentKinds, type DocumentKind } from "@lydoc/domain";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { PrismaDocumentRepository } from "./prisma-document.repository";

type UploadDocumentBody = Readonly<{
  kind?: DocumentKind;
  originalName?: string;
  mimeType?: string;
  contentBase64?: string;
}>;

const maxDocumentSizeBytes = 20 * 1024 * 1024;
const maxBase64Length = Math.ceil(maxDocumentSizeBytes / 3) * 4;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

@Controller("documents")
@UseGuards(AuthGuard)
export class DocumentsController {
  private readonly uploadUserDocument: UploadUserDocument;

  constructor(
    private readonly documents: PrismaDocumentRepository,
    storage: LocalEncryptedObjectStorageProvider,
  ) {
    this.uploadUserDocument = new UploadUserDocument(
      documents as DocumentRepository,
      storage,
    );
  }

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    const documents = await this.documents.listByOwner(this.requireUserId(request));

    return {
      documents: documents.map((document) => ({
        id: document.id,
        kind: document.kind,
        status: document.status,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        encrypted: document.encrypted,
      })),
    };
  }

  @Post()
  async upload(@Req() request: AuthenticatedRequest, @Body() body: UploadDocumentBody) {
    const document = await this.handleUploadError(() =>
      this.uploadUserDocument.execute({
        ownerId: this.requireUserId(request),
        kind: this.parseKind(body.kind),
        originalName: body.originalName ?? "document",
        mimeType: body.mimeType ?? "",
        bytes: this.decodeBase64(body.contentBase64),
      }),
    );

    return {
      document: {
        id: document.id,
        kind: document.kind,
        status: document.status,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        encrypted: document.encrypted,
      },
    };
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException("Session requise.");
    }

    return request.user.id;
  }

  private parseKind(kind: DocumentKind | undefined): DocumentKind {
    if (kind && documentKinds.includes(kind)) {
      return kind;
    }

    return "OTHER";
  }

  private decodeBase64(contentBase64: string | undefined): Uint8Array {
    if (
      !contentBase64 ||
      contentBase64.length > maxBase64Length ||
      !base64Pattern.test(contentBase64)
    ) {
      throw new BadRequestException("Contenu du document invalide.");
    }

    return Buffer.from(contentBase64, "base64");
  }

  private async handleUploadError<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new BadRequestException(error instanceof Error ? error.message : "Upload invalide.");
    }
  }
}
