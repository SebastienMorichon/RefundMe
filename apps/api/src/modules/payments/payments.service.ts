import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PaymentStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import { missingCustomerProfileFields } from "../identity/customer-profile";
import { readCaseValidationSnapshot } from "../eligibility/case-snapshots";
import { PrismaService } from "../prisma/prisma.service";
import { ShippingService } from "../shipping/shipping.service";
import { NotificationsService } from "../notifications/notifications.service";
import { requireManagedPostalEnabled } from "../../platform/feature-flags";
import {
  lockCustomerProfile,
  lockStripeCheckoutCase,
} from "../../platform/transaction-locks";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipping: ShippingService,
    private readonly notifications: NotificationsService,
  ) {}

  async createCheckoutSession(caseId: string, ownerId: string) {
    requireManagedPostalEnabled();
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: { id: caseId, ownerId, owner: { accountDeletedAt: null } },
      include: {
        owner: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            postalAddress: true,
            postalCode: true,
            city: true,
            country: true,
            phoneNumber: true,
            operatorCustomerReference: true,
          },
        },
        payment: true,
        postalShipment: true,
      },
    });
    if (!administrativeCase) {
      throw new NotFoundException("Dossier introuvable.");
    }
    if (administrativeCase.payment?.status === PaymentStatus.PAID) {
      throw new BadRequestException("Ce dossier est deja paye.");
    }
    if (administrativeCase.status !== "READY_TO_PAY") {
      throw new BadRequestException(
        "Le dossier doit etre complet avant le paiement.",
      );
    }
    if (administrativeCase.fulfillmentMode !== "MANAGED_POSTAL") {
      throw new BadRequestException(
        "Le paiement concerne uniquement l'envoi pris en charge par Lydoc.",
      );
    }
    if (
      !administrativeCase.validatedAt ||
      !readCaseValidationSnapshot(administrativeCase.validationSnapshotJson)
    ) {
      throw new BadRequestException(
        "Validez le recapitulatif du dossier avant le paiement.",
      );
    }
    const missingProfileFields = missingCustomerProfileFields(
      administrativeCase.owner,
    );
    if (missingProfileFields.length > 0) {
      throw new BadRequestException(
        `Completez votre profil avant le paiement : ${missingProfileFields.join(", ")}.`,
      );
    }
    if (
      !administrativeCase.postalShipment ||
      administrativeCase.postalShipment.status !== "QUOTED"
    ) {
      throw new BadRequestException(
        "Preparez et validez le devis postal avant le paiement.",
      );
    }
    const checkoutAmountCents =
      administrativeCase.serviceFeeCents +
      administrativeCase.postalShipment.totalCents;

    const stripe = this.createStripeClient();
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000")
      .split(",")[0]
      ?.trim();
    if (!appUrl) {
      throw new ServiceUnavailableException(
        "L'adresse de l'application n'est pas configuree.",
      );
    }

    return this.prisma.$transaction(
      async (transaction) => {
        await lockCustomerProfile(transaction, ownerId);
        await lockStripeCheckoutCase(transaction, caseId);
        const current = await transaction.administrativeCase.findFirst({
          where: {
            id: caseId,
            ownerId,
            owner: { accountDeletedAt: null },
          },
          include: { payment: true, postalShipment: true },
        });
        if (!current) {
          throw new NotFoundException("Dossier introuvable.");
        }
        if (current.payment?.status === PaymentStatus.PAID) {
          throw new BadRequestException("Ce dossier est deja paye.");
        }
        if (
          current.status !== "READY_TO_PAY" ||
          current.fulfillmentMode !== "MANAGED_POSTAL" ||
          !current.validatedAt ||
          !readCaseValidationSnapshot(current.validationSnapshotJson) ||
          !current.postalShipment ||
          current.postalShipment.status !== "QUOTED"
        ) {
          throw new BadRequestException(
            "Le dossier ou son devis a change. Rechargez-le avant le paiement.",
          );
        }
        const currentAmountCents =
          current.serviceFeeCents + current.postalShipment.totalCents;
        if (currentAmountCents !== checkoutAmountCents) {
          throw new BadRequestException(
            "Le montant du devis a change. Rechargez-le avant le paiement.",
          );
        }
        const printingCents =
          current.postalShipment.pricingSnapshotJson !== null
            ? current.postalShipment.printingCents
            : Math.max(
                0,
                current.postalShipment.totalCents -
                  current.postalShipment.postageCents,
              );
        const postageCents = Math.max(
          0,
          current.postalShipment.totalCents - printingCents,
        );
        if (
          current.payment?.status === PaymentStatus.PENDING &&
          current.payment.stripeCheckoutSession
        ) {
          const existingSession = await this.retrieveCheckoutSession(
            stripe,
            current.payment.stripeCheckoutSession,
          );
          if (
            existingSession &&
            isReusableCheckoutSession(current.payment, existingSession)
          ) {
            await transaction.auditLog.create({
              data: {
                actorId: ownerId,
                action: "STRIPE_CHECKOUT_REUSED",
                entityType: "AdministrativeCase",
                entityId: caseId,
                metadata: { stripeCheckoutSession: existingSession.id },
              },
            });
            return {
              url: existingSession.url as string,
              sessionId: existingSession.id,
            };
          }
          if (existingSession?.status === "complete") {
            throw new BadRequestException(
              "Le paiement est en cours de confirmation. Rechargez le dossier dans quelques instants.",
            );
          }
          if (existingSession?.status === "open") {
            await this.expireCheckoutSession(stripe, existingSession.id);
            await transaction.auditLog.create({
              data: {
                actorId: ownerId,
                action: "STRIPE_CHECKOUT_EXPIRED_BEFORE_REPLACEMENT",
                entityType: "AdministrativeCase",
                entityId: caseId,
                metadata: { stripeCheckoutSession: existingSession.id },
              },
            });
          } else if (existingSession && existingSession.status !== "expired") {
            throw new ServiceUnavailableException(
              "L'etat de la session Stripe existante est indetermine. Elle n'a pas ete remplacee.",
            );
          }
        }
        const idempotencyKey = checkoutIdempotencyKey({
          caseId,
          amountCents: checkoutAmountCents,
          shipmentUpdatedAt: current.postalShipment.updatedAt,
          paymentUpdatedAt: current.payment?.updatedAt ?? null,
        });

        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            client_reference_id: administrativeCase.id,
            customer_email: administrativeCase.owner.email,
            success_url: `${appUrl}/cases/${administrativeCase.id}?payment=success`,
            cancel_url: `${appUrl}/cases/${administrativeCase.id}?payment=cancelled`,
            line_items: [
              checkoutLineItem(
                current.serviceFeeCents,
                "Prise en charge Lydoc",
                `Vérification finale et préparation de l'envoi du dossier ${administrativeCase.id}`,
              ),
              checkoutLineItem(
                printingCents,
                "Impression et mise sous pli",
                "Impression du dossier complet et préparation du courrier",
              ),
              checkoutLineItem(
                postageCents,
                current.postalShipment.product === "vertesuivi"
                  ? "Lettre verte suivie"
                  : "Lettre verte",
                "Affranchissement postal",
              ),
            ].filter(
              (item): item is Stripe.Checkout.SessionCreateParams.LineItem =>
                item !== null,
            ),
            metadata: { caseId: administrativeCase.id, ownerId },
            payment_intent_data: {
              metadata: { caseId: administrativeCase.id, ownerId },
            },
          },
          { idempotencyKey },
        );
        if (!session.url) {
          throw new ServiceUnavailableException(
            "Stripe n'a pas retourne de page de paiement.",
          );
        }

        await transaction.payment.upsert({
          where: { caseId: administrativeCase.id },
          create: {
            caseId: administrativeCase.id,
            amountCents: checkoutAmountCents,
            currency: "eur",
            stripeCheckoutSession: session.id,
          },
          update: {
            status: PaymentStatus.PENDING,
            amountCents: checkoutAmountCents,
            currency: "eur",
            stripeCheckoutSession: session.id,
            stripePaymentIntent: null,
            paidAt: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: ownerId,
            action: "STRIPE_CHECKOUT_CREATED",
            entityType: "AdministrativeCase",
            entityId: caseId,
            metadata: {
              stripeCheckoutSession: session.id,
              amountCents: checkoutAmountCents,
              idempotencyKeyHash: createHash("sha256")
                .update(idempotencyKey)
                .digest("hex"),
            },
          },
        });

        return { url: session.url, sessionId: session.id };
      },
      { maxWait: 5_000, timeout: 45_000 },
    );
  }

  async handleStripeWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    if (!rawBody || !signature) {
      throw new BadRequestException("Webhook Stripe incomplet.");
    }

    const webhookSecret = this.requiredSecret(
      "STRIPE_WEBHOOK_SECRET",
      "whsec_",
    );
    let event: Stripe.Event;
    try {
      event = this.createStripeClient().webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch {
      throw new BadRequestException("Signature Stripe invalide.");
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      await this.markCheckoutPaid(event.data.object);
    } else if (event.type === "checkout.session.async_payment_failed") {
      await this.markCheckoutFailed(event.data.object);
    }

    return { received: true };
  }

  private async markCheckoutPaid(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const caseId = session.metadata?.caseId;
    if (!caseId || session.payment_status !== "paid") {
      return;
    }

    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : null;
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, caseId);
      const payment = await transaction.payment.findUnique({
        where: { caseId },
      });
      if (!payment || !checkoutMatchesPayment(payment, session)) {
        return "IGNORED" as const;
      }
      if (payment.status === PaymentStatus.PAID) {
        return "ALREADY_PAID" as const;
      }
      if (payment.status !== PaymentStatus.PENDING) {
        return "IGNORED" as const;
      }

      const updatedPayment = await transaction.payment.updateMany({
        where: {
          id: payment.id,
          caseId,
          status: PaymentStatus.PENDING,
          stripeCheckoutSession: session.id,
          amountCents: session.amount_total as number,
          currency: session.currency as string,
        },
        data: {
          status: PaymentStatus.PAID,
          stripePaymentIntent: paymentIntent,
          paidAt: payment.paidAt ?? new Date(),
        },
      });
      if (updatedPayment.count !== 1) {
        return "IGNORED" as const;
      }

      const updatedCase = await transaction.administrativeCase.updateMany({
        where: {
          id: caseId,
          status: "READY_TO_PAY",
          fulfillmentMode: "MANAGED_POSTAL",
        },
        data: { status: "PAID" },
      });
      await transaction.auditLog.create({
        data: {
          action:
            updatedCase.count === 1
              ? "STRIPE_CHECKOUT_PAID"
              : "STRIPE_CHECKOUT_PAID_CASE_STATE_MISMATCH",
          entityType: "AdministrativeCase",
          entityId: caseId,
          metadata: {
            stripeCheckoutSession: session.id,
            amountCents: payment.amountCents,
            currency: payment.currency,
          },
        },
      });
      return updatedCase.count === 1
        ? ("CONFIRMED" as const)
        : ("PAYMENT_ONLY" as const);
    });

    if (outcome === "CONFIRMED") {
      await this.notifications.sendCaseEvent(caseId, "PAYMENT_CONFIRMED");
      await this.shipping.submitPaidCase(caseId);
    } else if (outcome === "ALREADY_PAID") {
      // A duplicate webhook is also an opportunity to resume the idempotent
      // postal hand-off if the first delivery stopped after recording payment.
      await this.shipping.submitPaidCase(caseId);
    }
  }

  private async markCheckoutFailed(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const caseId = session.metadata?.caseId;
    if (!caseId) return;
    await this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, caseId);
      const payment = await transaction.payment.findUnique({
        where: { caseId },
      });
      if (!payment || !checkoutMatchesPayment(payment, session)) return;
      const failed = await transaction.payment.updateMany({
        where: {
          id: payment.id,
          caseId,
          stripeCheckoutSession: session.id,
          amountCents: session.amount_total as number,
          currency: session.currency as string,
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.FAILED },
      });
      if (failed.count === 1) {
        await transaction.auditLog.create({
          data: {
            action: "STRIPE_CHECKOUT_ASYNC_PAYMENT_FAILED",
            entityType: "AdministrativeCase",
            entityId: caseId,
            metadata: { stripeCheckoutSession: session.id },
          },
        });
      }
    });
  }

  private async retrieveCheckoutSession(
    stripe: Stripe,
    sessionId: string,
  ): Promise<Stripe.Checkout.Session | null> {
    try {
      return await stripe.checkout.sessions.retrieve(sessionId);
    } catch (error) {
      if (isStripeMissingResource(error)) return null;
      throw new ServiceUnavailableException(
        "Stripe est momentanement indisponible. La session existante n'a pas ete remplacee.",
      );
    }
  }

  private async expireCheckoutSession(
    stripe: Stripe,
    sessionId: string,
  ): Promise<void> {
    try {
      await stripe.checkout.sessions.expire(sessionId);
    } catch {
      throw new ServiceUnavailableException(
        "La session Stripe existante n'a pas pu etre fermee. Elle n'a pas ete remplacee.",
      );
    }
  }

  private createStripeClient(): Stripe {
    const prefix =
      process.env.NODE_ENV === "production" ? "sk_live_" : "sk_test_";
    return new Stripe(this.requiredSecret("STRIPE_SECRET_KEY", prefix), {
      maxNetworkRetries: 1,
      timeout: 10_000,
    });
  }

  private requiredSecret(name: string, prefix: string): string {
    const value = process.env[name]?.trim();
    if (!value || !value.startsWith(prefix) || value.includes("change_me")) {
      throw new ServiceUnavailableException(
        `${name} n'est pas correctement configure.`,
      );
    }
    return value;
  }
}

function checkoutLineItem(
  amountCents: number,
  name: string,
  description: string,
): Stripe.Checkout.SessionCreateParams.LineItem | null {
  if (amountCents <= 0) return null;
  return {
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: amountCents,
      product_data: { name, description },
    },
  };
}

export function checkoutMatchesPayment(
  payment: {
    caseId: string;
    amountCents: number;
    currency: string;
    stripeCheckoutSession: string | null;
  },
  session: Pick<
    Stripe.Checkout.Session,
    "id" | "amount_total" | "currency" | "metadata"
  >,
): boolean {
  return (
    session.metadata?.caseId === payment.caseId &&
    payment.stripeCheckoutSession === session.id &&
    session.amount_total === payment.amountCents &&
    session.currency === payment.currency
  );
}

export function isReusableCheckoutSession(
  payment: {
    caseId: string;
    status: PaymentStatus;
    amountCents: number;
    currency: string;
    stripeCheckoutSession: string | null;
  },
  session: Pick<
    Stripe.Checkout.Session,
    | "id"
    | "amount_total"
    | "currency"
    | "metadata"
    | "payment_status"
    | "status"
    | "url"
  >,
): boolean {
  return (
    payment.status === PaymentStatus.PENDING &&
    session.status === "open" &&
    session.payment_status === "unpaid" &&
    typeof session.url === "string" &&
    session.url.length > 0 &&
    checkoutMatchesPayment(payment, session)
  );
}

export function checkoutIdempotencyKey(input: {
  caseId: string;
  amountCents: number;
  shipmentUpdatedAt: Date | string;
  paymentUpdatedAt: Date | string | null;
}): string {
  const shipmentVersion = new Date(input.shipmentUpdatedAt).toISOString();
  const paymentVersion = input.paymentUpdatedAt
    ? new Date(input.paymentUpdatedAt).toISOString()
    : "first-attempt";
  const digest = createHash("sha256")
    .update(
      [input.caseId, input.amountCents, shipmentVersion, paymentVersion].join(
        ":",
      ),
    )
    .digest("hex");
  return `lydoc-checkout-${digest}`;
}

function isStripeMissingResource(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { statusCode?: unknown; code?: unknown };
  return value.statusCode === 404 || value.code === "resource_missing";
}
