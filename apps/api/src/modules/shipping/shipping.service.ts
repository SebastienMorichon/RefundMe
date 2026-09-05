import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PostalShipmentStatus } from "@prisma/client";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { readCaseValidationSnapshot } from "../eligibility/case-snapshots";
import { PacketsService } from "../packets/packets.service";
import { PricingService } from "../pricing/pricing.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  customerPostalAddress,
  ruleRecipientPostalAddress,
} from "./postal-address";
import {
  createPostalProvider,
  isPostalSubmissionOutcomeUnknown,
} from "./postal-provider";
import { requireManagedPostalEnabled } from "../../platform/feature-flags";
import {
  lockCustomerProfile,
  lockGeneratedPacketCase,
  lockStripeCheckoutCase,
} from "../../platform/transaction-locks";

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packets: PacketsService,
    private readonly pricing: PricingService,
    private readonly notifications: NotificationsService,
  ) {}

  async quote(caseId: string, ownerId: string) {
    requireManagedPostalEnabled();
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: { id: caseId, ownerId, owner: { accountDeletedAt: null } },
      include: { postalShipment: true, payment: true },
    });
    if (!administrativeCase)
      throw new NotFoundException("Dossier introuvable.");
    if (administrativeCase.fulfillmentMode !== "MANAGED_POSTAL") {
      throw new BadRequestException(
        "Choisissez l'envoi pris en charge avant de demander un devis postal.",
      );
    }
    if (
      !["READY_TO_PAY", "GENERATED", "PAID", "PRINT_READY", "SENT"].includes(
        administrativeCase.status,
      )
    ) {
      throw new BadRequestException(
        "Le dossier doit etre complet avant de preparer l'envoi postal.",
      );
    }
    const validation = readCaseValidationSnapshot(
      administrativeCase.validationSnapshotJson,
    );
    if (!administrativeCase.validatedAt || !validation) {
      throw new BadRequestException(
        "Validez le recapitulatif avant de preparer l'envoi postal.",
      );
    }
    if (
      administrativeCase.postalShipment &&
      ["PENDING", "PAID"].includes(administrativeCase.payment?.status ?? "")
    ) {
      return this.present(administrativeCase.postalShipment);
    }
    const renewableStatuses: PostalShipmentStatus[] = [
      PostalShipmentStatus.DRAFT,
      PostalShipmentStatus.FAILED,
      PostalShipmentStatus.QUOTED,
    ];
    if (
      administrativeCase.postalShipment &&
      !renewableStatuses.includes(administrativeCase.postalShipment.status)
    ) {
      return this.present(administrativeCase.postalShipment);
    }

    const packet = await this.packets.generatePostalPacket(caseId, ownerId);
    const pageCount = (await PDFDocument.load(packet.bytes)).getPageCount();
    const customerPricing = await this.pricing.calculate(pageCount);
    const product = customerPricing.product;
    const provider = createPostalProvider();
    const quote = await provider.preview({
      caseId,
      product,
      sender: customerPostalAddress(validation.customer),
      recipient: ruleRecipientPostalAddress(validation.rule),
      pdf: packet.bytes,
    });
    const shipment = await this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, ownerId);
      await lockStripeCheckoutCase(transaction, caseId);
      await lockGeneratedPacketCase(transaction, caseId);
      const current = await transaction.administrativeCase.findFirst({
        where: {
          id: caseId,
          ownerId,
          owner: { accountDeletedAt: null },
        },
        include: { postalShipment: true, payment: true },
      });
      if (
        !current ||
        current.updatedAt.getTime() !==
          administrativeCase.updatedAt.getTime() ||
        current.fulfillmentMode !== "MANAGED_POSTAL" ||
        !current.validatedAt ||
        !readCaseValidationSnapshot(current.validationSnapshotJson) ||
        !["READY_TO_PAY", "GENERATED"].includes(current.status) ||
        ["PENDING", "PAID", "REFUNDED"].includes(current.payment?.status ?? "")
      ) {
        throw new BadRequestException(
          "Le dossier a change pendant la preparation du devis. Rechargez-le avant de recommencer.",
        );
      }
      const saved = await transaction.postalShipment.upsert({
        where: { caseId },
        create: {
          caseId,
          provider: quote.provider,
          environment: quote.environment,
          product,
          status: PostalShipmentStatus.QUOTED,
          providerUid: quote.uid,
          postageCents: customerPricing.postageCents,
          printingCents: customerPricing.printingCents,
          providerPostageCents: quote.postageCents,
          providerServiceCents: quote.serviceCents,
          providerTotalCents: quote.totalCents,
          totalCents: customerPricing.postalTotalCents,
          pricingSnapshotJson: customerPricing,
          previewUrl: quote.previewUrl,
          quotedAt: new Date(),
          errorMessage: null,
          providerRequestId: null,
        },
        update: {
          provider: quote.provider,
          environment: quote.environment,
          product,
          status: PostalShipmentStatus.QUOTED,
          providerUid: quote.uid,
          postageCents: customerPricing.postageCents,
          printingCents: customerPricing.printingCents,
          providerPostageCents: quote.postageCents,
          providerServiceCents: quote.serviceCents,
          providerTotalCents: quote.totalCents,
          totalCents: customerPricing.postalTotalCents,
          pricingSnapshotJson: customerPricing,
          previewUrl: quote.previewUrl,
          quotedAt: new Date(),
          errorMessage: null,
          providerRequestId: null,
        },
      });
      await transaction.administrativeCase.update({
        where: { id: caseId },
        data: { serviceFeeCents: customerPricing.serviceFeeCents },
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "POSTAL_SHIPMENT_QUOTED",
          entityType: "AdministrativeCase",
          entityId: caseId,
          metadata: {
            provider: quote.provider,
            environment: quote.environment,
            product,
            pageCount,
            customerPricing,
            providerCosts: {
              postageCents: quote.postageCents,
              serviceCents: quote.serviceCents,
              totalCents: quote.totalCents,
            },
          },
        },
      });
      return saved;
    });
    return this.present(shipment);
  }

  async get(caseId: string, ownerId: string) {
    const shipment = await this.prisma.postalShipment.findFirst({
      where: {
        caseId,
        case: { ownerId, owner: { accountDeletedAt: null } },
      },
    });
    return shipment ? this.present(shipment) : null;
  }

  async submitPaidCase(caseId: string): Promise<void> {
    const claim = await this.prisma.$transaction(async (transaction) => {
      const ownedCase = await transaction.administrativeCase.findUnique({
        where: { id: caseId },
        select: { ownerId: true },
      });
      if (!ownedCase) return null;
      await lockCustomerProfile(transaction, ownedCase.ownerId);
      await lockStripeCheckoutCase(transaction, caseId);
      const administrativeCase = await transaction.administrativeCase.findFirst(
        {
          where: {
            id: caseId,
            ownerId: ownedCase.ownerId,
            owner: { accountDeletedAt: null },
          },
          include: { payment: true, postalShipment: true },
        },
      );
      const shipment = administrativeCase?.postalShipment;
      const providerUid = shipment?.providerUid;
      if (
        !administrativeCase ||
        !shipment ||
        !administrativeCase.payment ||
        administrativeCase.payment.status !== "PAID" ||
        administrativeCase.status !== "PAID" ||
        administrativeCase.fulfillmentMode !== "MANAGED_POSTAL" ||
        shipment.status !== PostalShipmentStatus.QUOTED ||
        !providerUid
      ) {
        return null;
      }

      const expectedAmount =
        administrativeCase.serviceFeeCents + shipment.totalCents;
      if (administrativeCase.payment.amountCents < expectedAmount) {
        await transaction.postalShipment.updateMany({
          where: {
            id: shipment.id,
            status: PostalShipmentStatus.QUOTED,
          },
          data: {
            status: PostalShipmentStatus.FAILED,
            errorMessage:
              "Les frais postaux n'ont pas ete inclus dans le paiement.",
          },
        });
        return null;
      }

      const providerRequestId = randomUUID();
      const claimed = await transaction.postalShipment.updateMany({
        where: { id: shipment.id, status: PostalShipmentStatus.QUOTED },
        data: {
          status: PostalShipmentStatus.SUBMITTING,
          providerRequestId,
          errorMessage: null,
        },
      });
      return claimed.count === 1
        ? { shipment, providerRequestId, providerUid }
        : null;
    });
    if (!claim) return;

    const { shipment, providerRequestId, providerUid } = claim;
    let providerAccepted = false;
    try {
      const provider = createPostalProvider();
      if (
        provider.name !== shipment.provider ||
        provider.environment !== shipment.environment
      ) {
        throw new Error(
          "La configuration postale ne correspond plus au devis valide.",
        );
      }
      await provider.submit(providerUid, caseId);
      providerAccepted = true;
      const finalized = await this.finalizePostalSubmission({
        caseId,
        shipmentId: shipment.id,
        providerUid,
        providerRequestId,
      });
      if (finalized) {
        await this.notifications.sendCaseEvent(caseId, "POSTAL_SUBMITTED");
      } else {
        await this.markSubmissionOutcomeUnknown(
          shipment.id,
          caseId,
          new Error("POSTAL_SUBMISSION_FINALIZATION_MISMATCH"),
        );
      }
    } catch (error) {
      if (providerAccepted || isPostalSubmissionOutcomeUnknown(error)) {
        await this.markSubmissionOutcomeUnknown(shipment.id, caseId, error);
        return;
      }
      await this.fail(
        shipment.id,
        caseId,
        error instanceof Error ? error.message : "Echec de l'envoi postal.",
      );
    }
  }

  private async finalizePostalSubmission(input: {
    caseId: string;
    shipmentId: string;
    providerUid: string;
    providerRequestId: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, input.caseId);
      const administrativeCase =
        await transaction.administrativeCase.findUnique({
          where: { id: input.caseId },
          include: { payment: true, postalShipment: true },
        });
      const shipment = administrativeCase?.postalShipment;
      if (
        !administrativeCase ||
        !shipment ||
        shipment.id !== input.shipmentId ||
        shipment.providerRequestId !== input.providerRequestId ||
        administrativeCase.payment?.status !== "PAID" ||
        ["REFUNDED", "CANCELLED"].includes(administrativeCase.status)
      ) {
        await transaction.auditLog.create({
          data: {
            action: "POSTAL_SUBMISSION_CASE_STATE_MISMATCH",
            entityType: "AdministrativeCase",
            entityId: input.caseId,
            metadata: {
              shipmentId: input.shipmentId,
              caseStatus: administrativeCase?.status ?? null,
              paymentStatus: administrativeCase?.payment?.status ?? null,
            },
          },
        });
        return false;
      }

      let recorded = false;
      if (shipment.status === PostalShipmentStatus.SUBMITTING) {
        const updated = await transaction.postalShipment.updateMany({
          where: {
            id: shipment.id,
            status: PostalShipmentStatus.SUBMITTING,
            providerRequestId: input.providerRequestId,
          },
          data: {
            status: PostalShipmentStatus.SUBMITTED,
            submittedAt: new Date(),
            errorMessage: null,
          },
        });
        recorded = updated.count === 1;
      } else {
        const progressedStatuses: PostalShipmentStatus[] = [
          PostalShipmentStatus.SUBMITTED,
          PostalShipmentStatus.PRODUCED,
          PostalShipmentStatus.HANDED_OVER,
          PostalShipmentStatus.IN_TRANSIT,
          PostalShipmentStatus.DELIVERED,
        ];
        recorded = progressedStatuses.includes(shipment.status);
      }
      if (!recorded) {
        await transaction.auditLog.create({
          data: {
            action: "POSTAL_SUBMISSION_STATE_REQUIRES_RECONCILIATION",
            entityType: "AdministrativeCase",
            entityId: input.caseId,
            metadata: {
              shipmentId: shipment.id,
              shipmentStatus: shipment.status,
              providerRequestId: input.providerRequestId,
            },
          },
        });
        return false;
      }

      const sentStatuses: PostalShipmentStatus[] = [
        PostalShipmentStatus.HANDED_OVER,
        PostalShipmentStatus.IN_TRANSIT,
        PostalShipmentStatus.DELIVERED,
      ];
      await transaction.administrativeCase.updateMany({
        where: { id: input.caseId, status: "PAID" },
        data: {
          status: sentStatuses.includes(shipment.status)
            ? "SENT"
            : "PRINT_READY",
        },
      });
      await transaction.auditLog.create({
        data: {
          action: "POSTAL_SHIPMENT_SUBMITTED",
          entityType: "AdministrativeCase",
          entityId: input.caseId,
          metadata: {
            providerUid: input.providerUid,
            providerRequestId: input.providerRequestId,
          },
        },
      });
      return true;
    });
  }

  private async markSubmissionOutcomeUnknown(
    shipmentId: string,
    caseId: string,
    error: unknown,
  ): Promise<void> {
    const message =
      "La demande a peut-etre ete acceptee par le prestataire. Confirmation en attente de reconciliation.";
    await this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, caseId);
      const updated = await transaction.postalShipment.updateMany({
        where: {
          id: shipmentId,
          status: PostalShipmentStatus.SUBMITTING,
        },
        data: { errorMessage: message },
      });
      if (updated.count !== 1) return;
      await transaction.auditLog.create({
        data: {
          action: "POSTAL_SUBMISSION_OUTCOME_UNKNOWN",
          entityType: "AdministrativeCase",
          entityId: caseId,
          metadata: {
            shipmentId,
            errorType:
              error instanceof Error ? error.constructor.name : "Unknown",
            reconciliationRequired: true,
          },
        },
      });
    });
  }

  async refresh(caseId: string, ownerId: string) {
    const shipment = await this.prisma.postalShipment.findFirst({
      where: { caseId, case: { ownerId } },
    });
    if (!shipment) throw new NotFoundException("Envoi postal introuvable.");
    if (
      !shipment.providerUid ||
      shipment.status === PostalShipmentStatus.QUOTED
    )
      return this.present(shipment);
    const provider = createPostalProvider();
    if (
      provider.name !== shipment.provider ||
      provider.environment !== shipment.environment
    ) {
      throw new BadRequestException(
        "La configuration postale ne correspond pas à cet envoi.",
      );
    }
    const tracking = await provider.tracking(shipment.providerUid);
    const latest = tracking.events[0];
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, caseId);
      const current = await transaction.postalShipment.findFirst({
        where: { id: shipment.id, caseId, case: { ownerId } },
      });
      if (
        !current ||
        current.providerUid !== shipment.providerUid ||
        current.provider !== shipment.provider ||
        current.environment !== shipment.environment
      ) {
        throw new BadRequestException(
          "L'envoi a change pendant la consultation du suivi. Rechargez-le.",
        );
      }
      const status = monotonicPostalStatus(
        current.status,
        mapStatus(latest?.code, current.status),
      );
      const saved = await transaction.postalShipment.update({
        where: { id: current.id },
        data: {
          status,
          trackingNumber: tracking.trackingNumber,
          proofOfDepositUrl:
            tracking.proofOfDepositUrl ?? current.proofOfDepositUrl,
          lastEventJson: { events: tracking.events },
          trackingUpdatedAt: new Date(),
          ...(status === PostalShipmentStatus.PRODUCED
            ? { producedAt: new Date() }
            : {}),
          ...(status === PostalShipmentStatus.HANDED_OVER
            ? { handedOverAt: new Date() }
            : {}),
          ...(status === PostalShipmentStatus.DELIVERED
            ? { deliveredAt: new Date() }
            : {}),
        },
      });
      const sentStatuses: PostalShipmentStatus[] = [
        PostalShipmentStatus.HANDED_OVER,
        PostalShipmentStatus.IN_TRANSIT,
        PostalShipmentStatus.DELIVERED,
      ];
      if (sentStatuses.includes(status)) {
        await transaction.administrativeCase.updateMany({
          where: {
            id: caseId,
            status: { in: ["PAID", "PRINT_READY"] },
          },
          data: { status: "SENT" },
        });
      }
      return { saved, status, previousStatus: current.status };
    });
    if (
      outcome.status === PostalShipmentStatus.DELIVERED &&
      outcome.previousStatus !== PostalShipmentStatus.DELIVERED
    ) {
      await this.notifications.sendCaseEvent(caseId, "POSTAL_DELIVERED");
    }
    return this.present(outcome.saved);
  }

  async handleServicePostalWebhook(
    payload: Record<string, unknown>,
    authentication: PostalWebhookAuthentication,
  ) {
    const authenticated = authenticatePostalWebhook(authentication);
    const providerUid = readText(payload.uuid);
    const code = readText(payload.code_statut);
    if (!providerUid || !code) {
      throw new BadRequestException("Webhook postal incomplet.");
    }
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`postal-webhook:${authenticated.replayKey}`}))
      `;
      const replay = await transaction.auditLog.findFirst({
        where: {
          action: "POSTAL_WEBHOOK_REPLAY_GUARD",
          entityType: "PostalWebhook",
          entityId: authenticated.replayKey,
        },
        select: { id: true },
      });
      if (replay) {
        return { replayed: true, notifyCaseId: null };
      }

      let shipment = await transaction.postalShipment.findFirst({
        where: { provider: "service_postal", providerUid },
      });
      if (!shipment) {
        await transaction.auditLog.create({
          data: {
            action: "POSTAL_WEBHOOK_REPLAY_GUARD",
            entityType: "PostalWebhook",
            entityId: authenticated.replayKey,
            metadata: {
              authenticationMode: authenticated.mode,
              providerUidHash: createHash("sha256")
                .update(providerUid)
                .digest("hex"),
              matchedShipment: false,
            },
          },
        });
        return { replayed: false, notifyCaseId: null };
      }

      await lockStripeCheckoutCase(transaction, shipment.caseId);
      shipment = await transaction.postalShipment.findFirst({
        where: {
          id: shipment.id,
          provider: "service_postal",
          providerUid,
        },
      });
      if (!shipment) {
        await transaction.auditLog.create({
          data: {
            action: "POSTAL_WEBHOOK_REPLAY_GUARD",
            entityType: "PostalWebhook",
            entityId: authenticated.replayKey,
            metadata: {
              authenticationMode: authenticated.mode,
              providerUidHash: createHash("sha256")
                .update(providerUid)
                .digest("hex"),
              matchedShipment: false,
              disappearedWhileWaitingForLock: true,
            },
          },
        });
        return { replayed: false, notifyCaseId: null };
      }

      const proposedStatus = mapStatus(code, shipment.status);
      const status = monotonicPostalStatus(shipment.status, proposedStatus);
      const staleTransition =
        proposedStatus !== shipment.status && status === shipment.status;
      const now = new Date();
      if (!staleTransition) {
        const event = {
          code,
          message: readText(payload.message_statut) || code,
          date: readText(payload.date_statut) || now.toISOString(),
        };
        await transaction.postalShipment.update({
          where: { id: shipment.id },
          data: {
            status,
            trackingNumber:
              readText(payload.numero_suivi_laposte) || shipment.trackingNumber,
            proofOfDepositUrl:
              readHttpsUrl(payload.preuve_depot_url) ??
              shipment.proofOfDepositUrl,
            lastEventJson: { source: "webhook", events: [event] },
            trackingUpdatedAt: now,
            ...(status === PostalShipmentStatus.PRODUCED && !shipment.producedAt
              ? { producedAt: now }
              : {}),
            ...(status === PostalShipmentStatus.HANDED_OVER &&
            !shipment.handedOverAt
              ? { handedOverAt: now }
              : {}),
            ...(status === PostalShipmentStatus.DELIVERED &&
            !shipment.deliveredAt
              ? { deliveredAt: now }
              : {}),
          },
        });
        const sentStatuses: PostalShipmentStatus[] = [
          PostalShipmentStatus.HANDED_OVER,
          PostalShipmentStatus.IN_TRANSIT,
          PostalShipmentStatus.DELIVERED,
        ];
        if (sentStatuses.includes(status)) {
          await transaction.administrativeCase.updateMany({
            where: {
              id: shipment.caseId,
              status: { in: ["PAID", "PRINT_READY"] },
            },
            data: { status: "SENT" },
          });
        }
      }
      await transaction.auditLog.createMany({
        data: [
          {
            action: "POSTAL_WEBHOOK_REPLAY_GUARD",
            entityType: "PostalWebhook",
            entityId: authenticated.replayKey,
            metadata: {
              authenticationMode: authenticated.mode,
              matchedShipment: true,
            },
          },
          {
            action: staleTransition
              ? "POSTAL_WEBHOOK_STALE_TRANSITION_IGNORED"
              : "POSTAL_WEBHOOK_RECEIVED",
            entityType: "AdministrativeCase",
            entityId: shipment.caseId,
            metadata: {
              providerUid,
              code,
              previousStatus: shipment.status,
              proposedStatus,
              appliedStatus: status,
              authenticationMode: authenticated.mode,
            },
          },
        ],
      });
      return {
        replayed: false,
        notifyCaseId:
          status === PostalShipmentStatus.DELIVERED &&
          shipment.status !== PostalShipmentStatus.DELIVERED
            ? shipment.caseId
            : null,
      };
    });
    if (outcome.notifyCaseId) {
      await this.notifications.sendCaseEvent(
        outcome.notifyCaseId,
        "POSTAL_DELIVERED",
      );
    }
    return { received: true, replayed: outcome.replayed };
  }

  private async fail(shipmentId: string, caseId: string, message: string) {
    await this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, caseId);
      await transaction.postalShipment.updateMany({
        where: {
          id: shipmentId,
          status: {
            in: [
              PostalShipmentStatus.DRAFT,
              PostalShipmentStatus.QUOTED,
              PostalShipmentStatus.SUBMITTING,
            ],
          },
        },
        data: {
          status: PostalShipmentStatus.FAILED,
          errorMessage: message.slice(0, 500),
        },
      });
    });
  }

  private present(shipment: {
    provider: string;
    environment: string;
    product: string;
    status: PostalShipmentStatus;
    postageCents: number;
    printingCents: number;
    providerPostageCents: number;
    providerServiceCents: number;
    providerTotalCents: number;
    totalCents: number;
    pricingSnapshotJson: unknown;
    currency: string;
    previewUrl: string | null;
    trackingNumber: string | null;
    proofOfDepositUrl: string | null;
    errorMessage: string | null;
    quotedAt: Date | null;
    submittedAt: Date | null;
    deliveredAt: Date | null;
  }) {
    const hasConfiguredPricing = shipment.pricingSnapshotJson !== null;
    return {
      provider: shipment.provider,
      environment: shipment.environment,
      product: shipment.product,
      status: shipment.status,
      postageCents: shipment.postageCents,
      printingCents: hasConfiguredPricing
        ? shipment.printingCents
        : Math.max(0, shipment.totalCents - shipment.postageCents),
      totalCents: shipment.totalCents,
      currency: shipment.currency,
      previewUrl: shipment.previewUrl,
      trackingNumber: shipment.trackingNumber,
      proofOfDepositUrl: shipment.proofOfDepositUrl,
      errorMessage: shipment.errorMessage,
      quotedAt: shipment.quotedAt,
      submittedAt: shipment.submittedAt,
      deliveredAt: shipment.deliveredAt,
      simulation:
        shipment.provider === "mock" || shipment.environment !== "production",
    };
  }
}

export type PostalWebhookAuthentication = Readonly<{
  rawBody: Buffer | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
  legacyToken: string | undefined;
}>;

type AuthenticatedPostalWebhook = Readonly<{
  mode: "hmac" | "legacy-token";
  replayKey: string;
}>;

export function authenticatePostalWebhook(
  input: PostalWebhookAuthentication,
): AuthenticatedPostalWebhook {
  const secret = postalWebhookSecret();
  if (input.signature || input.timestamp) {
    if (!input.rawBody || !input.signature || !input.timestamp) {
      throw new UnauthorizedException("Webhook postal non autorise.");
    }
    return {
      mode: "hmac",
      replayKey: verifyPostalWebhookHmac({
        rawBody: input.rawBody,
        signature: input.signature,
        timestamp: input.timestamp,
        secret,
      }),
    };
  }

  if (process.env.SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN !== "true") {
    throw new UnauthorizedException("Webhook postal non autorise.");
  }
  if (!input.rawBody) {
    throw new UnauthorizedException("Webhook postal non autorise.");
  }
  assertLegacyWebhookSecret(input.legacyToken, secret);
  return {
    mode: "legacy-token",
    replayKey: createHash("sha256")
      .update("legacy-token.")
      .update(input.rawBody)
      .digest("hex"),
  };
}

export function verifyPostalWebhookHmac(input: {
  rawBody: Buffer;
  signature: string;
  timestamp: string;
  secret: string;
  nowMilliseconds?: number;
  toleranceSeconds?: number;
}): string {
  const timestampMilliseconds = parseWebhookTimestamp(input.timestamp);
  const now = input.nowMilliseconds ?? Date.now();
  const toleranceSeconds = input.toleranceSeconds ?? webhookToleranceSeconds();
  if (
    !Number.isFinite(toleranceSeconds) ||
    toleranceSeconds <= 0 ||
    Math.abs(now - timestampMilliseconds) > toleranceSeconds * 1_000
  ) {
    throw new UnauthorizedException("Webhook postal expire.");
  }

  const received = decodeWebhookSignature(input.signature);
  const expected = createHmac("sha256", input.secret)
    .update(input.timestamp)
    .update(".")
    .update(input.rawBody)
    .digest();
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new UnauthorizedException("Webhook postal non autorise.");
  }
  return createHash("sha256")
    .update(input.timestamp)
    .update(".")
    .update(received)
    .digest("hex");
}

export function monotonicPostalStatus(
  current: PostalShipmentStatus,
  proposed: PostalShipmentStatus,
): PostalShipmentStatus {
  if (current === proposed) return current;
  const terminalStatuses: PostalShipmentStatus[] = [
    PostalShipmentStatus.DELIVERED,
    PostalShipmentStatus.FAILED,
    PostalShipmentStatus.CANCELLED,
  ];
  if (terminalStatuses.includes(current)) return current;
  if (
    proposed === PostalShipmentStatus.FAILED ||
    proposed === PostalShipmentStatus.CANCELLED
  ) {
    return proposed;
  }
  const rank: Partial<Record<PostalShipmentStatus, number>> = {
    [PostalShipmentStatus.DRAFT]: 0,
    [PostalShipmentStatus.QUOTED]: 1,
    [PostalShipmentStatus.SUBMITTING]: 2,
    [PostalShipmentStatus.SUBMITTED]: 3,
    [PostalShipmentStatus.PRODUCED]: 4,
    [PostalShipmentStatus.HANDED_OVER]: 5,
    [PostalShipmentStatus.IN_TRANSIT]: 6,
    [PostalShipmentStatus.DELIVERED]: 7,
  };
  return (rank[proposed] ?? -1) >= (rank[current] ?? Number.MAX_SAFE_INTEGER)
    ? proposed
    : current;
}

function mapStatus(
  code: string | undefined,
  fallback: PostalShipmentStatus,
): PostalShipmentStatus {
  if (["soumis", "lettre_validee", "courrier_valide"].includes(code ?? "")) {
    return PostalShipmentStatus.SUBMITTED;
  }
  if (code === "courrier_produit") return PostalShipmentStatus.PRODUCED;
  if (code === "pris_en_charge") return PostalShipmentStatus.HANDED_OVER;
  if (
    code === "distribue_destinataire" ||
    code === "distribue_destinataire_en_lot"
  )
    return PostalShipmentStatus.DELIVERED;
  if (code) return PostalShipmentStatus.IN_TRANSIT;
  return fallback;
}

function postalWebhookSecret(): string {
  const secret = process.env.SERVICE_POSTAL_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 24 || secret.includes("change_me")) {
    throw new UnauthorizedException("Webhook postal non autorise.");
  }
  return secret;
}

function assertLegacyWebhookSecret(
  token: string | undefined,
  expected: string,
): void {
  if (!token) {
    throw new UnauthorizedException("Webhook postal non autorise.");
  }
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(token);
  if (
    expectedBytes.length !== receivedBytes.length ||
    !timingSafeEqual(expectedBytes, receivedBytes)
  ) {
    throw new UnauthorizedException("Webhook postal non autorise.");
  }
}

function parseWebhookTimestamp(value: string): number {
  if (!/^\d{10,13}$/.test(value)) {
    throw new UnauthorizedException("Webhook postal non autorise.");
  }
  const numeric = Number(value);
  const milliseconds = value.length === 13 ? numeric : numeric * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new UnauthorizedException("Webhook postal non autorise.");
  }
  return milliseconds;
}

function decodeWebhookSignature(value: string): Buffer {
  const signature = value.trim().replace(/^sha256=/i, "");
  if (/^[a-f\d]{64}$/i.test(signature)) {
    return Buffer.from(signature, "hex");
  }
  try {
    const decoded = Buffer.from(signature, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to the uniform authentication error below.
  }
  throw new UnauthorizedException("Webhook postal non autorise.");
}

function webhookToleranceSeconds(): number {
  const configured = Number.parseInt(
    process.env.SERVICE_POSTAL_WEBHOOK_TOLERANCE_SECONDS ?? "300",
    10,
  );
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 3_600)
    : 300;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readHttpsUrl(value: unknown): string | null {
  const text = readText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
