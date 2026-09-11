import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PaymentStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { requireManagedPostalEnabled } from "../../platform/feature-flags";
import { lockCustomerProfile, lockStripeCheckoutCase } from "../../platform/transaction-locks";
import { readCaseValidationSnapshot } from "../eligibility/case-snapshots";
import { missingCustomerProfileFields } from "../identity/customer-profile";
import { NotificationsService } from "../notifications/notifications.service";
import { PricingService } from "../pricing/pricing.service";
import { PrismaService } from "../prisma/prisma.service";
import { ShippingService } from "../shipping/shipping.service";

type SumUpCheckout = {
  id: string;
  checkout_reference?: string;
  amount?: number;
  currency?: string;
  status?: string;
  hosted_checkout_url?: string;
  date?: string;
  valid_until?: string;
  transactions?: Array<{ id?: string; status?: string }>;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipping: ShippingService,
    private readonly notifications: NotificationsService,
    private readonly pricing: PricingService,
  ) {}

  async createCheckoutSession(caseId: string, ownerId: string) {
    requireManagedPostalEnabled();
    await this.pricing.requirePaymentEnabled();
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
    if (!administrativeCase) throw new NotFoundException("Dossier introuvable.");
    this.assertCaseCanBePaid(administrativeCase);

    const checkoutAmountCents = administrativeCase.serviceFeeCents + administrativeCase.postalShipment!.totalCents;
    const appUrl = requiredApplicationUrl();

    return this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, ownerId);
      await lockStripeCheckoutCase(transaction, caseId);
      const current = await transaction.administrativeCase.findFirst({
        where: { id: caseId, ownerId, owner: { accountDeletedAt: null } },
        include: { payment: true, postalShipment: true },
      });
      if (!current) throw new NotFoundException("Dossier introuvable.");
      this.assertCaseCanBePaid(current);
      const paymentConfiguration = await transaction.pricingConfiguration.findUnique({
        where: { id: "default" },
        select: { paymentEnabled: true },
      });
      if (!paymentConfiguration?.paymentEnabled) {
        throw new ServiceUnavailableException(
          "Le paiement en ligne vient d'etre desactive par Lydoc.",
        );
      }
      const currentAmountCents = current.serviceFeeCents + current.postalShipment!.totalCents;
      if (currentAmountCents !== checkoutAmountCents) {
        throw new BadRequestException("Le montant du devis a change. Rechargez-le avant le paiement.");
      }

      if (
        current.payment?.status === PaymentStatus.PENDING &&
        current.payment.provider === "sumup" &&
        current.payment.providerCheckoutId
      ) {
        const existing = await this.retrieveCheckout(current.payment.providerCheckoutId);
        if (existing && isReusableSumUpCheckout(current.payment, existing)) {
          await transaction.auditLog.create({
            data: {
              actorId: ownerId,
              action: "SUMUP_CHECKOUT_REUSED",
              entityType: "AdministrativeCase",
              entityId: caseId,
              metadata: { sumUpCheckoutId: existing.id },
            },
          });
          return { url: existing.hosted_checkout_url!, sessionId: existing.id };
        }
        if (existing?.status === "PAID") {
          throw new BadRequestException("Le paiement est en cours de confirmation. Rechargez le dossier dans quelques instants.");
        }
      }

      const reference = checkoutReference({
        caseId,
        amountCents: currentAmountCents,
        shipmentUpdatedAt: current.postalShipment!.updatedAt,
        paymentUpdatedAt: current.payment?.updatedAt ?? null,
      });
      const checkout = await this.createSumUpCheckout({
        reference,
        amountCents: currentAmountCents,
        description: `Impression et envoi Lydoc - dossier ${caseId.slice(0, 24)}`,
        returnUrl: `${requiredApiUrl()}/payments/sumup/webhook`,
        redirectUrl: `${appUrl}/cases/${caseId}?payment=success`,
      });
      if (!checkout.id || !checkout.hosted_checkout_url) {
        throw new ServiceUnavailableException("SumUp n'a pas retourne de page de paiement.");
      }

      const snapshot = readPricingSnapshot(current.postalShipment!.pricingSnapshotJson, current.serviceFeeCents);
      await transaction.payment.upsert({
        where: { caseId },
        create: {
          caseId,
          amountCents: currentAmountCents,
          currency: "eur",
          provider: "sumup",
          providerCheckoutId: checkout.id,
          providerReference: reference,
          serviceFeeCents: snapshot.serviceFeeCents,
          discountCents: snapshot.discountCents,
          discountLabel: snapshot.discountLabel,
          promoCode: snapshot.promoCode,
        },
        update: {
          status: PaymentStatus.PENDING,
          amountCents: currentAmountCents,
          currency: "eur",
          provider: "sumup",
          providerCheckoutId: checkout.id,
          providerReference: reference,
          serviceFeeCents: snapshot.serviceFeeCents,
          discountCents: snapshot.discountCents,
          discountLabel: snapshot.discountLabel,
          promoCode: snapshot.promoCode,
          stripeCheckoutSession: null,
          stripePaymentIntent: null,
          providerTransactionId: null,
          paidAt: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "SUMUP_CHECKOUT_CREATED",
          entityType: "AdministrativeCase",
          entityId: caseId,
          metadata: {
            sumUpCheckoutId: checkout.id,
            amountCents: currentAmountCents,
            referenceHash: createHash("sha256").update(reference).digest("hex"),
            discountCents: snapshot.discountCents,
            promoCode: snapshot.promoCode,
          },
        },
      });
      return { url: checkout.hosted_checkout_url, sessionId: checkout.id };
    }, { maxWait: 5_000, timeout: 45_000 });
  }

  async handleSumUpWebhook(payload: Record<string, unknown>) {
    const checkoutId = typeof payload.id === "string" ? payload.id.trim() : "";
    if (!checkoutId) throw new BadRequestException("Webhook SumUp incomplet.");
    const checkout = await this.retrieveCheckout(checkoutId);
    if (!checkout) throw new BadRequestException("Paiement SumUp introuvable.");
    const payment = await this.prisma.payment.findFirst({
      where: { provider: "sumup", providerCheckoutId: checkoutId },
      select: { caseId: true },
    });
    if (!payment) return { received: true };

    if (isSuccessfulSumUpCheckout(checkout)) {
      await this.markCheckoutPaid(payment.caseId, checkout);
    } else if (["FAILED", "EXPIRED"].includes(checkout.status ?? "")) {
      await this.markCheckoutFailed(payment.caseId, checkout);
    }
    return { received: true };
  }

  private async markCheckoutPaid(caseId: string, checkout: SumUpCheckout): Promise<void> {
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, caseId);
      const payment = await transaction.payment.findUnique({ where: { caseId } });
      if (!payment || !sumUpCheckoutMatchesPayment(payment, checkout)) return "IGNORED" as const;
      if (payment.status === PaymentStatus.PAID) return "ALREADY_PAID" as const;
      if (payment.status !== PaymentStatus.PENDING) return "IGNORED" as const;
      const transactionId = checkout.transactions?.find((item) => item.status === "SUCCESSFUL")?.id ?? null;
      const updatedPayment = await transaction.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING, providerCheckoutId: checkout.id },
        data: {
          status: PaymentStatus.PAID,
          providerTransactionId: transactionId,
          paidAt: new Date(),
        },
      });
      if (updatedPayment.count !== 1) return "IGNORED" as const;
      const updatedCase = await transaction.administrativeCase.updateMany({
        where: { id: caseId, status: "READY_TO_PAY", fulfillmentMode: "MANAGED_POSTAL" },
        data: { status: "PAID" },
      });
      await transaction.auditLog.create({
        data: {
          action: updatedCase.count === 1 ? "SUMUP_CHECKOUT_PAID" : "SUMUP_CHECKOUT_PAID_CASE_STATE_MISMATCH",
          entityType: "AdministrativeCase",
          entityId: caseId,
          metadata: { sumUpCheckoutId: checkout.id, transactionId, amountCents: payment.amountCents },
        },
      });
      return updatedCase.count === 1 ? "CONFIRMED" as const : "PAYMENT_ONLY" as const;
    });
    if (outcome === "CONFIRMED") {
      await this.notifications.sendCaseEvent(caseId, "PAYMENT_CONFIRMED");
      await this.shipping.submitPaidCase(caseId);
    } else if (outcome === "ALREADY_PAID") {
      await this.shipping.submitPaidCase(caseId);
    }
  }

  private async markCheckoutFailed(caseId: string, checkout: SumUpCheckout): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockStripeCheckoutCase(transaction, caseId);
      const payment = await transaction.payment.findUnique({ where: { caseId } });
      if (!payment || !sumUpCheckoutMatchesPayment(payment, checkout)) return;
      await transaction.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
    });
  }

  private assertCaseCanBePaid(administrativeCase: {
    status: string;
    fulfillmentMode: string | null;
    validatedAt: Date | null;
    validationSnapshotJson: unknown;
    payment: { status: PaymentStatus } | null;
    postalShipment: { status: string } | null;
    owner?: Parameters<typeof missingCustomerProfileFields>[0];
  }): void {
    if (administrativeCase.payment?.status === PaymentStatus.PAID) throw new BadRequestException("Ce dossier est deja paye.");
    if (administrativeCase.status !== "READY_TO_PAY") throw new BadRequestException("Le dossier doit etre complet avant le paiement.");
    if (administrativeCase.fulfillmentMode !== "MANAGED_POSTAL") throw new BadRequestException("Le paiement concerne uniquement l'envoi pris en charge par Lydoc.");
    if (!administrativeCase.validatedAt || !readCaseValidationSnapshot(administrativeCase.validationSnapshotJson)) {
      throw new BadRequestException("Validez le recapitulatif du dossier avant le paiement.");
    }
    if (administrativeCase.owner) {
      const missing = missingCustomerProfileFields(administrativeCase.owner);
      if (missing.length > 0) throw new BadRequestException(`Completez votre profil avant le paiement : ${missing.join(", ")}.`);
    }
    if (!administrativeCase.postalShipment || administrativeCase.postalShipment.status !== "QUOTED") {
      throw new BadRequestException("Preparez et validez le devis postal avant le paiement.");
    }
  }

  private async createSumUpCheckout(input: {
    reference: string;
    amountCents: number;
    description: string;
    returnUrl: string;
    redirectUrl: string;
  }): Promise<SumUpCheckout> {
    return this.sumUpRequest("/v0.1/checkouts", {
      method: "POST",
      body: JSON.stringify({
        checkout_reference: input.reference,
        amount: input.amountCents / 100,
        currency: "EUR",
        merchant_code: requiredEnvironment("SUMUP_MERCHANT_CODE"),
        description: input.description,
        return_url: input.returnUrl,
        redirect_url: input.redirectUrl,
        hosted_checkout: { enabled: true },
      }),
    });
  }

  private async retrieveCheckout(id: string): Promise<SumUpCheckout | null> {
    try {
      return await this.sumUpRequest(`/v0.1/checkouts/${encodeURIComponent(id)}`, { method: "GET" });
    } catch (error) {
      if (error instanceof SumUpRequestError && error.responseStatus === 404) return null;
      throw error;
    }
  }

  private async sumUpRequest(path: string, init: RequestInit): Promise<SumUpCheckout> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${requiredEnvironment("SUMUP_API_KEY")}`);
    headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetch(`https://api.sumup.com${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException("SumUp est momentanement indisponible.");
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new SumUpRequestError(response.status, readSumUpError(payload));
    }
    return payload as SumUpCheckout;
  }
}

class SumUpRequestError extends ServiceUnavailableException {
  constructor(readonly responseStatus: number, message: string) { super(message); }
}

export function sumUpCheckoutMatchesPayment(
  payment: { amountCents: number; currency: string; providerCheckoutId: string | null; providerReference: string | null },
  checkout: SumUpCheckout,
): boolean {
  return payment.providerCheckoutId === checkout.id &&
    payment.providerReference === checkout.checkout_reference &&
    payment.amountCents === eurosToCents(checkout.amount) &&
    payment.currency.toUpperCase() === checkout.currency?.toUpperCase();
}

export function isReusableSumUpCheckout(
  payment: { status: PaymentStatus; amountCents: number; currency: string; providerCheckoutId: string | null; providerReference: string | null },
  checkout: SumUpCheckout,
): boolean {
  return payment.status === PaymentStatus.PENDING && checkout.status === "PENDING" &&
    Boolean(checkout.hosted_checkout_url) && checkoutIsFresh(checkout) &&
    sumUpCheckoutMatchesPayment(payment, checkout);
}

export function isSuccessfulSumUpCheckout(checkout: SumUpCheckout): boolean {
  return checkout.status === "PAID" &&
    Boolean(checkout.transactions?.some((item) => item.status === "SUCCESSFUL"));
}

export function checkoutReference(input: {
  caseId: string;
  amountCents: number;
  shipmentUpdatedAt: Date | string;
  paymentUpdatedAt: Date | string | null;
}): string {
  const digest = createHash("sha256").update([
    input.caseId,
    input.amountCents,
    new Date(input.shipmentUpdatedAt).toISOString(),
    input.paymentUpdatedAt ? new Date(input.paymentUpdatedAt).toISOString() : "first-attempt",
  ].join(":")).digest("hex").slice(0, 32);
  return `lydoc-${input.caseId.slice(0, 24)}-${digest}`;
}

function readPricingSnapshot(value: unknown, serviceFeeCents: number) {
  const snapshot = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    serviceFeeCents,
    discountCents: typeof snapshot.discountCents === "number" ? snapshot.discountCents : 0,
    discountLabel: typeof snapshot.discountLabel === "string" ? snapshot.discountLabel : null,
    promoCode: typeof snapshot.promoCode === "string" ? snapshot.promoCode : null,
  };
}

function checkoutIsFresh(checkout: SumUpCheckout): boolean {
  const expiry = checkout.valid_until ? new Date(checkout.valid_until).getTime() : Number.NaN;
  if (Number.isFinite(expiry)) return expiry > Date.now();
  const created = checkout.date ? new Date(checkout.date).getTime() : Number.NaN;
  return !Number.isFinite(created) || created + 30 * 60_000 > Date.now();
}

function eurosToCents(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : -1;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /change[_-]?me/i.test(value)) throw new ServiceUnavailableException(`${name} n'est pas correctement configure.`);
  return value;
}

function requiredApplicationUrl(): string {
  const value = (process.env.APP_URL ?? "http://localhost:3000").split(",")[0]?.trim();
  if (!value) throw new ServiceUnavailableException("L'adresse de l'application n'est pas configuree.");
  return value;
}

function requiredApiUrl(): string {
  const value = (process.env.API_URL ?? "http://localhost:3001").split(",")[0]?.trim();
  if (!value) throw new ServiceUnavailableException("L'adresse de l'API n'est pas configuree.");
  return value;
}

function readSumUpError(payload: Record<string, unknown>): string {
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  return message || "SumUp a refuse la creation du paiement.";
}
