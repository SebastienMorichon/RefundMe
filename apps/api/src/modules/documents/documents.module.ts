import { Module } from "@nestjs/common";
import { join } from "node:path";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import { IdentityModule } from "../identity/identity.module";
import { AdminInvoicesController } from "./admin-invoices.controller";
import { DocumentsController } from "./documents.controller";
import { PrismaDocumentRepository } from "./prisma-document.repository";

@Module({
  imports: [IdentityModule],
  controllers: [DocumentsController, AdminInvoicesController],
  providers: [
    PrismaDocumentRepository,
    {
      provide: LocalEncryptedObjectStorageProvider,
      useFactory: () =>
        new LocalEncryptedObjectStorageProvider(
          process.env.DOCUMENT_STORAGE_DIR ?? join(process.cwd(), "../../var/storage"),
        ),
    },
  ],
  exports: [LocalEncryptedObjectStorageProvider, PrismaDocumentRepository],
})
export class DocumentsModule {}
