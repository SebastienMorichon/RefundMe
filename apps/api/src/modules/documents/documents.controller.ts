import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Readable } from "node:stream";
import {
  UploadUserDocument,
  type DocumentRepository,
} from "@lydoc/application";
import { documentKinds, type DocumentKind } from "@lydoc/domain";
import {
  DocumentStorageCapacityError,
  LocalEncryptedObjectStorageProvider,
  PdfImageDocumentSecurityScanner,
  PdfImageDocumentWatermarkProvider,
} from "@lydoc/infrastructure";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import {
  GlobalDocumentStorageQuotaError,
  PrismaDocumentRepository,
} from "./prisma-document.repository";
import { DocumentLifecycleService } from "./document-lifecycle.service";
import { UploadConcurrencyInterceptor } from "./upload-concurrency.interceptor";

type UploadDocumentBody = Readonly<{ kind?: DocumentKind }>;
type UploadedDocumentFile = Readonly<{
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}>;

const maxDocumentSizeBytes = 20 * 1024 * 1024;
const maxDocumentsPerAccount = 50;
const maxStoredBytesPerAccount = 100 * 1024 * 1024;
const boundedMemoryUploadStorage = {
  _handleFile(
    _request: unknown,
    file: { stream: Readable },
    callback: (
      error: Error | null,
      information?: {
        buffer: Buffer;
        size: number;
      },
    ) => void,
  ) {
    void readBoundedUpload(file.stream).then(
      (information) => callback(null, information),
      (error: unknown) =>
        callback(
          error instanceof Error ? error : new Error("Upload interrompu."),
        ),
    );
  },
  _removeFile(
    _request: unknown,
    _file: unknown,
    callback: (error: Error | null) => void,
  ) {
    callback(null);
  },
};

async function readBoundedUpload(
  stream: Readable,
): Promise<{ buffer: Buffer; size: number }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxDocumentSizeBytes) {
      throw new BadRequestException("Fichier trop volumineux.");
    }
    chunks.push(bytes);
  }
  return { buffer: Buffer.concat(chunks, size), size };
}

@Controller("documents")
@UseGuards(AuthGuard)
export class DocumentsController {
  private readonly uploadUserDocument: UploadUserDocument;

  constructor(
    private readonly documents: PrismaDocumentRepository,
    private readonly lifecycle: DocumentLifecycleService,
    storage: LocalEncryptedObjectStorageProvider,
    watermarker: PdfImageDocumentWatermarkProvider,
    securityScanner: PdfImageDocumentSecurityScanner,
  ) {
    this.uploadUserDocument = new UploadUserDocument(
      documents as DocumentRepository,
      storage,
      watermarker,
      securityScanner,
      {
        maxDocuments: maxDocumentsPerAccount,
        maxStoredBytes: maxStoredBytesPerAccount,
      },
    );
  }

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    const documents = await this.documents.listByOwner(
      this.requireUserId(request),
    );

    return {
      documents: documents.map((document) => ({
        id: document.id,
        kind: document.kind,
        status: document.status,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        encrypted: document.encrypted,
        watermarked: document.watermarked,
      })),
    };
  }

  @Post()
  @UseInterceptors(
    UploadConcurrencyInterceptor,
    FileInterceptor("file", {
      storage: boundedMemoryUploadStorage,
      limits: {
        fileSize: maxDocumentSizeBytes,
        files: 1,
        fields: 1,
        // Busboy counts the closing boundary when enforcing this limit. The
        // expected `kind` field plus one file therefore need a limit of 3.
        parts: 3,
        fieldNameSize: 64,
        fieldSize: 128,
        headerPairs: 32,
      },
    }),
  )
  async upload(
    @Req() request: AuthenticatedRequest,
    @Body() body: UploadDocumentBody,
    @UploadedFile() file: UploadedDocumentFile | undefined,
  ) {
    if (!file || file.size < 1) {
      throw new BadRequestException("Fichier manquant ou vide.");
    }
    const document = await this.handleUploadError(() => {
      return this.uploadUserDocument.execute({
        ownerId: this.requireUserId(request),
        kind: this.parseKind(body.kind),
        originalName: file.originalname,
        mimeType: file.mimetype,
        bytes: file.buffer,
      });
    });

    return {
      document: {
        id: document.id,
        kind: document.kind,
        status: document.status,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        encrypted: document.encrypted,
        watermarked: document.watermarked,
      },
    };
  }

  @Delete(":id")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("id") documentId: string,
  ) {
    return {
      deletion: await this.lifecycle.requestDeletion(
        documentId,
        this.requireUserId(request),
      ),
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

  private async handleUploadError<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (
        error instanceof DocumentStorageCapacityError ||
        error instanceof GlobalDocumentStorageQuotaError
      ) {
        throw new ServiceUnavailableException(
          "Le stockage documentaire est temporairement indisponible.",
        );
      }

      const message = error instanceof Error ? error.message : "";
      throw new BadRequestException(
        isSafeUploadMessage(message)
          ? message
          : "Le document n'a pas pu etre accepte. Verifiez son format et reessayez.",
      );
    }
  }
}

function isSafeUploadMessage(message: string): boolean {
  return [
    "document depasse",
    "type MIME",
    "extension",
    "nom du document",
    "format declare",
    "fichier PDF",
    "PDF est incomplet",
    "PDF doit contenir",
    "page du PDF",
    "PDF contenant",
    "document est endommage",
    "Format d'image",
    "image est animee",
    "Impossible de proteger ce document",
    "quota de documents",
  ].some((allowedFragment) => message.includes(allowedFragment));
}
