import { Module } from "@nestjs/common";
import { join } from "node:path";
import {
  LocalEncryptedObjectStorageProvider,
  EncryptedSensitiveTextProvider,
  PdfImageDocumentSecurityScanner,
  PdfImageDocumentWatermarkProvider,
} from "@lydoc/infrastructure";
import { IdentityModule } from "../identity/identity.module";
import { AdminInvoicesController } from "./admin-invoices.controller";
import { AdminDocumentLifecycleController } from "./admin-document-lifecycle.controller";
import { DocumentLifecycleService } from "./document-lifecycle.service";
import { DocumentsController } from "./documents.controller";
import { PrismaDocumentRepository } from "./prisma-document.repository";
import { UploadConcurrencyInterceptor } from "./upload-concurrency.interceptor";
import { StorageWriteReservations } from "../../platform/storage-write-reservations";

@Module({
  imports: [IdentityModule],
  controllers: [
    DocumentsController,
    AdminInvoicesController,
    AdminDocumentLifecycleController,
  ],
  providers: [
    PrismaDocumentRepository,
    DocumentLifecycleService,
    StorageWriteReservations,
    UploadConcurrencyInterceptor,
    PdfImageDocumentSecurityScanner,
    PdfImageDocumentWatermarkProvider,
    {
      provide: EncryptedSensitiveTextProvider,
      useFactory: () => new EncryptedSensitiveTextProvider(),
    },
    {
      provide: LocalEncryptedObjectStorageProvider,
      useFactory: () =>
        new LocalEncryptedObjectStorageProvider(
          process.env.DOCUMENT_STORAGE_DIR ??
            join(process.cwd(), "../../var/storage"),
        ),
    },
  ],
  exports: [
    LocalEncryptedObjectStorageProvider,
    EncryptedSensitiveTextProvider,
    PrismaDocumentRepository,
    StorageWriteReservations,
  ],
})
export class DocumentsModule {}
