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
import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
}>;

const maxDocumentSizeBytes = 20 * 1024 * 1024;
const maxDocumentsPerAccount = 50;
const maxStoredBytesPerAccount = 100 * 1024 * 1024;
const temporaryUploadDirectory = resolve(tmpdir(), "lydoc-uploads");
const temporaryUploadStorage = {
  _handleFile(
    _request: unknown,
    file: { stream: Readable },
    callback: (
      error: Error | null,
      information?: {
        destination: string;
        filename: string;
        path: string;
        size: number;
      },
    ) => void,
  ) {
    void mkdir(temporaryUploadDirectory, { recursive: true })
      .then(async () => {
        const filename = `${randomUUID()}.upload`;
        const path = resolve(temporaryUploadDirectory, filename);
        const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
        let size = 0;
        file.stream.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
        });
        try {
          await pipeline(file.stream, output);
          callback(null, {
            destination: temporaryUploadDirectory,
            filename,
            path,
            size,
          });
        } catch (error) {
          await unlink(path).catch(() => undefined);
          callback(
            error instanceof Error ? error : new Error("Upload interrompu."),
          );
        }
      })
      .catch((error: unknown) =>
        callback(
          error instanceof Error
            ? error
            : new Error("Stockage temporaire indisponible."),
        ),
      );
  },
  _removeFile(
    _request: unknown,
    file: { path?: string },
    callback: (error: Error | null) => void,
  ) {
    if (!file.path) {
      callback(null);
      return;
    }
    void unlink(file.path)
      .then(() => callback(null))
      .catch((error: unknown) =>
        callback(error instanceof Error ? error : new Error("Nettoyage impossible.")),
      );
  },
};

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
      storage: temporaryUploadStorage,
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
    if (!file?.path || file.size < 1) {
      throw new BadRequestException("Fichier manquant ou vide.");
    }
    const document = await this.handleUploadError(async () => {
      try {
        return await this.uploadUserDocument.execute({
          ownerId: this.requireUserId(request),
          kind: this.parseKind(body.kind),
          originalName: file.originalname,
          mimeType: file.mimetype,
          bytes: await readFile(file.path),
        });
      } finally {
        await unlink(file.path).catch(() => undefined);
      }
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
