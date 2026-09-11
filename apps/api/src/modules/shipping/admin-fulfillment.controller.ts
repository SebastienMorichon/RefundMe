import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import type { Response } from "express";
import { lockStripeCheckoutCase } from "../../platform/transaction-locks";
import { AdminGuard } from "../identity/admin.guard";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import {
  assertPersistedPacket,
  generatedPacketEncryptionContext,
} from "../packets/packets.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

@Controller("admin/fulfillment")
@UseGuards(AuthGuard, AdminGuard)
export class AdminFulfillmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list() {
    const cases = await this.prisma.administrativeCase.findMany({
      where: {
        fulfillmentMode: "MANAGED_POSTAL",
        status: "PRINT_READY",
        payment: { is: { status: "PAID" } },
        postalShipment: { is: { provider: "manual" } },
        owner: { accountDeletedAt: null },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        owner: { select: { email: true, firstName: true, lastName: true } },
        payment: { select: { amountCents: true, paidAt: true } },
        postalShipment: {
          select: { product: true, status: true, postageCents: true },
        },
        generatedPackets: {
          where: { purgeRequestedAt: null },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { updatedAt: "asc" },
      take: 200,
    });
    return {
      cases: cases.map((item) => ({
        id: item.id,
        status: item.status,
        createdAt: item.createdAt,
        customer: {
          email: item.owner.email,
          name: [item.owner.firstName, item.owner.lastName]
            .filter(Boolean)
            .join(" ") || null,
        },
        payment: item.payment,
        shipment: item.postalShipment,
        packetReady: item.generatedPackets.length > 0,
      })),
    };
  }

  @Get(":id/dossier.pdf")
  async download(
    @Param("id") caseId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: {
        id: caseId,
        fulfillmentMode: "MANAGED_POSTAL",
        status: { in: ["PAID", "PRINT_READY", "SENT"] },
        payment: { is: { status: "PAID" } },
        postalShipment: { is: { provider: "manual" } },
      },
      select: {
        ownerId: true,
        generatedPackets: {
          where: { purgeRequestedAt: null },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });
    const packet = administrativeCase?.generatedPackets[0];
    if (!administrativeCase || !packet) {
      throw new NotFoundException("Dossier pret a imprimer introuvable.");
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.storage.getDecryptedObject({
        object: {
          bucket: packet.storageBucket,
          key: packet.storageKey,
          checksumSha256: packet.checksumSha256,
          sizeBytes: packet.sizeBytes,
        },
        encryptionContext: generatedPacketEncryptionContext(
          administrativeCase.ownerId,
          caseId,
        ),
      });
      await assertPersistedPacket(bytes, packet.checksumSha256);
    } catch {
      throw new BadRequestException(
        "Le PDF ne peut pas etre dechiffre ou son integrite est invalide.",
      );
    }
    await this.prisma.auditLog.create({
      data: {
        actorId: request.user!.id,
        action: "MANAGED_PACKET_DOWNLOADED",
        entityType: "AdministrativeCase",
        entityId: caseId,
      },
    });
    response.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="dossier-lydoc-${caseId}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(Buffer.from(bytes));
  }

  @Post(":id/sent")
  async markSent(
    @Param("id") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const updated = await this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, caseId);
      const current = await transaction.administrativeCase.findFirst({
        where: {
          id: caseId,
          status: "PRINT_READY",
          fulfillmentMode: "MANAGED_POSTAL",
          payment: { is: { status: "PAID" } },
          postalShipment: { is: { provider: "manual" } },
        },
        include: { postalShipment: true },
      });
      if (!current?.postalShipment) return false;
      const sentAt = new Date();
      await transaction.postalShipment.update({
        where: { id: current.postalShipment.id },
        data: {
          status: "HANDED_OVER",
          handedOverAt: sentAt,
          trackingUpdatedAt: sentAt,
        },
      });
      await transaction.administrativeCase.update({
        where: { id: caseId },
        data: { status: "SENT" },
      });
      await transaction.auditLog.create({
        data: {
          actorId: request.user!.id,
          action: "MANUAL_POSTAL_SHIPMENT_MARKED_SENT",
          entityType: "AdministrativeCase",
          entityId: caseId,
        },
      });
      return true;
    });
    if (!updated) {
      throw new BadRequestException(
        "Ce dossier n'est plus dans la file des envois a effectuer.",
      );
    }
    await this.notifications.sendCaseEvent(caseId, "POSTAL_SUBMITTED");
    return { sent: true };
  }
}
