import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PostalShipmentStatus } from "@prisma/client";
import { readCaseValidationSnapshot } from "../eligibility/case-snapshots";
import { PacketsService } from "../packets/packets.service";
import { PrismaService } from "../prisma/prisma.service";
import { customerPostalAddress, ruleRecipientPostalAddress } from "./postal-address";
import { createPostalProvider } from "./postal-provider";

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packets: PacketsService,
  ) {}

  async quote(caseId: string, ownerId: string) {
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: { id: caseId, ownerId },
      include: { postalShipment: true, payment: true },
    });
    if (!administrativeCase) throw new NotFoundException("Dossier introuvable.");
    if (!["READY_TO_PAY", "PAID", "PRINT_READY", "SENT"].includes(administrativeCase.status)) {
      throw new BadRequestException("Le dossier doit etre complet avant de preparer l'envoi postal.");
    }
    const validation = readCaseValidationSnapshot(administrativeCase.validationSnapshotJson);
    if (!administrativeCase.validatedAt || !validation) {
      throw new BadRequestException("Validez le recapitulatif avant de preparer l'envoi postal.");
    }
    if (administrativeCase.postalShipment && ["PENDING", "PAID"].includes(administrativeCase.payment?.status ?? "")) {
      return this.present(administrativeCase.postalShipment);
    }
    const renewableStatuses: PostalShipmentStatus[] = [PostalShipmentStatus.DRAFT, PostalShipmentStatus.FAILED, PostalShipmentStatus.QUOTED];
    if (administrativeCase.postalShipment && !renewableStatuses.includes(administrativeCase.postalShipment.status)) {
      return this.present(administrativeCase.postalShipment);
    }

    const provider = createPostalProvider();
    const product = readProduct();
    const packet = await this.packets.generatePostalPacket(caseId, ownerId);
    const quote = await provider.preview({
      caseId,
      product,
      sender: customerPostalAddress(validation.customer),
      recipient: ruleRecipientPostalAddress(validation.rule),
      pdf: packet.bytes,
    });
    const shipment = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.postalShipment.upsert({
        where: { caseId },
        create: {
          caseId,
          provider: quote.provider,
          environment: quote.environment,
          product,
          status: PostalShipmentStatus.QUOTED,
          providerUid: quote.uid,
          postageCents: quote.postageCents,
          providerServiceCents: quote.serviceCents,
          totalCents: quote.totalCents,
          previewUrl: quote.previewUrl,
          quotedAt: new Date(),
          errorMessage: null,
        },
        update: {
          provider: quote.provider,
          environment: quote.environment,
          product,
          status: PostalShipmentStatus.QUOTED,
          providerUid: quote.uid,
          postageCents: quote.postageCents,
          providerServiceCents: quote.serviceCents,
          totalCents: quote.totalCents,
          previewUrl: quote.previewUrl,
          quotedAt: new Date(),
          errorMessage: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "POSTAL_SHIPMENT_QUOTED",
          entityType: "AdministrativeCase",
          entityId: caseId,
          metadata: { provider: quote.provider, environment: quote.environment, totalCents: quote.totalCents, product },
        },
      });
      return saved;
    });
    return this.present(shipment);
  }

  async get(caseId: string, ownerId: string) {
    const shipment = await this.prisma.postalShipment.findFirst({ where: { caseId, case: { ownerId } } });
    return shipment ? this.present(shipment) : null;
  }

  async submitPaidCase(caseId: string): Promise<void> {
    const administrativeCase = await this.prisma.administrativeCase.findUnique({
      where: { id: caseId },
      include: { payment: true, postalShipment: true },
    });
    const shipment = administrativeCase?.postalShipment;
    if (!administrativeCase || !shipment || !administrativeCase.payment || administrativeCase.payment.status !== "PAID") return;
    if (shipment.status !== PostalShipmentStatus.QUOTED || !shipment.providerUid) return;
    const expectedAmount = administrativeCase.serviceFeeCents + shipment.totalCents;
    if (administrativeCase.payment.amountCents < expectedAmount) {
      await this.fail(shipment.id, "Les frais postaux n'ont pas ete inclus dans le paiement.");
      return;
    }
    try {
      const provider = createPostalProvider();
      if (provider.name !== shipment.provider || provider.environment !== shipment.environment) {
        throw new Error("La configuration postale ne correspond plus au devis valide.");
      }
      await provider.submit(shipment.providerUid, caseId);
      await this.prisma.$transaction([
        this.prisma.postalShipment.update({
          where: { id: shipment.id },
          data: { status: PostalShipmentStatus.SUBMITTED, submittedAt: new Date(), errorMessage: null },
        }),
        this.prisma.administrativeCase.update({ where: { id: caseId }, data: { status: "PRINT_READY" } }),
        this.prisma.auditLog.create({
          data: { action: "POSTAL_SHIPMENT_SUBMITTED", entityType: "AdministrativeCase", entityId: caseId, metadata: { providerUid: shipment.providerUid } },
        }),
      ]);
    } catch (error) {
      await this.fail(shipment.id, error instanceof Error ? error.message : "Echec de l'envoi postal.");
    }
  }

  async refresh(caseId: string, ownerId: string) {
    const shipment = await this.prisma.postalShipment.findFirst({ where: { caseId, case: { ownerId } } });
    if (!shipment) throw new NotFoundException("Envoi postal introuvable.");
    if (!shipment.providerUid || shipment.status === PostalShipmentStatus.QUOTED) return this.present(shipment);
    const tracking = await createPostalProvider().tracking(shipment.providerUid);
    const latest = tracking.events[0];
    const status = mapStatus(latest?.code, shipment.status);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.postalShipment.update({
        where: { id: shipment.id },
        data: {
          status,
          trackingNumber: tracking.trackingNumber,
          lastEventJson: { events: tracking.events },
          ...(status === PostalShipmentStatus.PRODUCED ? { producedAt: new Date() } : {}),
          ...(status === PostalShipmentStatus.HANDED_OVER ? { handedOverAt: new Date() } : {}),
          ...(status === PostalShipmentStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
        },
      });
      const sentStatuses: PostalShipmentStatus[] = [PostalShipmentStatus.HANDED_OVER, PostalShipmentStatus.IN_TRANSIT, PostalShipmentStatus.DELIVERED];
      if (sentStatuses.includes(status)) {
        await transaction.administrativeCase.update({ where: { id: caseId }, data: { status: "SENT" } });
      }
      return saved;
    });
    return this.present(updated);
  }

  private async fail(shipmentId: string, message: string) {
    await this.prisma.postalShipment.update({
      where: { id: shipmentId },
      data: { status: PostalShipmentStatus.FAILED, errorMessage: message.slice(0, 500) },
    });
  }

  private present(shipment: {
    provider: string; environment: string; product: string; status: PostalShipmentStatus;
    postageCents: number; providerServiceCents: number; totalCents: number; currency: string;
    previewUrl: string | null; trackingNumber: string | null; proofOfDepositUrl: string | null;
    errorMessage: string | null; quotedAt: Date | null; submittedAt: Date | null; deliveredAt: Date | null;
  }) {
    return { ...shipment, simulation: shipment.provider === "mock" || shipment.environment !== "production" };
  }
}

function readProduct(): "verte" | "vertesuivi" {
  return process.env.SERVICE_POSTAL_DEFAULT_PRODUCT === "verte" ? "verte" : "vertesuivi";
}

function mapStatus(code: string | undefined, fallback: PostalShipmentStatus): PostalShipmentStatus {
  if (code === "courrier_produit") return PostalShipmentStatus.PRODUCED;
  if (code === "pris_en_charge") return PostalShipmentStatus.HANDED_OVER;
  if (code === "distribue_destinataire" || code === "distribue_destinataire_en_lot") return PostalShipmentStatus.DELIVERED;
  if (code) return PostalShipmentStatus.IN_TRANSIT;
  return fallback;
}
