import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { DocumentKind } from "@prisma/client";
import type { Response } from "express";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import { AdminGuard } from "../identity/admin.guard";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { PrismaService } from "../prisma/prisma.service";

@Controller("admin/invoices")
@UseGuards(AuthGuard, AdminGuard)
export class AdminInvoicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
  ) {}

  @Get()
  async list() {
    const invoices = await this.prisma.document.findMany({
      where: {
        kind: DocumentKind.ORANGE_INVOICE,
        ownerId: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        uploadedAt: true,
        analyzedAt: true,
        owner: { select: { email: true } },
        caseDocuments: {
          select: { case: { select: { id: true, status: true } } },
        },
      },
      orderBy: { uploadedAt: "desc" },
      take: 200,
    });

    return {
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        originalName: invoice.originalName,
        mimeType: invoice.mimeType,
        sizeBytes: invoice.sizeBytes,
        status: invoice.status,
        uploadedAt: invoice.uploadedAt,
        analyzedAt: invoice.analyzedAt,
        customerEmail: invoice.owner?.email ?? "Compte supprime",
        cases: invoice.caseDocuments.map(({ case: administrativeCase }) => ({
          id: administrativeCase.id,
          status: administrativeCase.status,
        })),
      })),
    };
  }

  @Get(":id/file")
  async view(
    @Param("id") documentId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const invoice = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        kind: DocumentKind.ORANGE_INVOICE,
        ownerId: { not: null },
        deletedAt: null,
      },
    });
    if (!invoice?.ownerId) {
      throw new NotFoundException("Facture introuvable.");
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.storage.getDecryptedObject({
        object: {
          bucket: invoice.storageBucket,
          key: invoice.storageKey,
          checksumSha256: invoice.checksumSha256,
          sizeBytes: invoice.sizeBytes,
        },
        encryptionContext: {
          ownerId: invoice.ownerId,
          documentKind: invoice.kind,
        },
      });
    } catch {
      throw new BadRequestException(
        "Cette facture ne peut pas etre dechiffree avec la cle actuelle.",
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: request.user!.id,
        action: "CLIENT_INVOICE_VIEWED",
        entityType: "Document",
        entityId: invoice.id,
        metadata: { kind: invoice.kind },
      },
    });

    response.set({
      "Content-Type": invoice.mimeType,
      "Content-Disposition": `attachment; filename="facture-client-${invoice.id}${fileExtension(invoice.mimeType)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(Buffer.from(bytes));
  }
}

function fileExtension(mimeType: string): string {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  return "";
}
