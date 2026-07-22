import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PaymentStatus } from "@prisma/client";
import Stripe from "stripe";
import { missingCustomerProfileFields } from "../identity/customer-profile";
import { readCaseValidationSnapshot } from "../eligibility/case-snapshots";
import { PrismaService } from "../prisma/prisma.service";
import { ShippingService } from "../shipping/shipping.service";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipping: ShippingService,
  ) {}

  async createCheckoutSession(caseId: string, ownerId: string) {
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: { id: caseId, ownerId },
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
      throw new BadRequestException("Le dossier doit etre complet avant le paiement.");
    }
    if (administrativeCase.fulfillmentMode !== "MANAGED_POSTAL") {
      throw new BadRequestException("Le paiement concerne uniquement l'envoi pris en charge par Lydoc.");
    }
    if (!administrativeCase.validatedAt || !readCaseValidationSnapshot(administrativeCase.validationSnapshotJson)) {
      throw new BadRequestException("Validez le recapitulatif du dossier avant le paiement.");
    }
    const missingProfileFields = missingCustomerProfileFields(administrativeCase.owner);
    if (missingProfileFields.length > 0) {
      throw new BadRequestException(
        `Completez votre profil avant le paiement : ${missingProfileFields.join(", ")}.`,
      );
    }
    if (!administrativeCase.postalShipment || administrativeCase.postalShipment.status !== "QUOTED") {
      throw new BadRequestException("Preparez et validez le devis postal avant le paiement.");
    }
    const checkoutAmountCents = administrativeCase.serviceFeeCents + administrativeCase.postalShipment.totalCents;

    const stripe = this.createStripeClient();
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").split(",")[0]?.trim();
    if (!appUrl) {
      throw new ServiceUnavailableException("L'adresse de l'application n'est pas configuree.");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: administrativeCase.id,
      customer_email: administrativeCase.owner.email,
      success_url: `${appUrl}/cases/${administrativeCase.id}?payment=success`,
      cancel_url: `${appUrl}/cases/${administrativeCase.id}?payment=cancelled`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: administrativeCase.serviceFeeCents,
            product_data: {
              name: "Prise en charge Lydoc",
              description: `Vérification finale et préparation de l'envoi du dossier ${administrativeCase.id}`,
            },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: administrativeCase.postalShipment.totalCents,
            product_data: {
              name: "Impression et envoi postal",
              description: administrativeCase.postalShipment.product === "vertesuivi" ? "Lettre verte suivie" : "Lettre verte",
            },
          },
        },
      ],
      metadata: { caseId: administrativeCase.id, ownerId },
      payment_intent_data: { metadata: { caseId: administrativeCase.id, ownerId } },
    });
    if (!session.url) {
      throw new ServiceUnavailableException("Stripe n'a pas retourne de page de paiement.");
    }

    await this.prisma.payment.upsert({
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

    return { url: session.url, sessionId: session.id };
  }

  async handleStripeWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature) {
      throw new BadRequestException("Webhook Stripe incomplet.");
    }

    const webhookSecret = this.requiredSecret("STRIPE_WEBHOOK_SECRET", "whsec_");
    let event: Stripe.Event;
    try {
      event = this.createStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
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

  private async markCheckoutPaid(session: Stripe.Checkout.Session): Promise<void> {
    const caseId = session.metadata?.caseId;
    if (!caseId || session.payment_status !== "paid") {
      return;
    }

    const payment = await this.prisma.payment.findUnique({ where: { caseId } });
    if (!payment || !checkoutMatchesPayment(payment, session)) {
      return;
    }

    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAID,
          stripePaymentIntent: paymentIntent,
          paidAt: payment.paidAt ?? new Date(),
        },
      }),
      this.prisma.administrativeCase.updateMany({
        where: { id: caseId, status: "READY_TO_PAY" },
        data: { status: "PAID" },
      }),
    ]);
    await this.shipping.submitPaidCase(caseId);
  }

  private async markCheckoutFailed(session: Stripe.Checkout.Session): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { stripeCheckoutSession: session.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.FAILED },
    });
  }

  private createStripeClient(): Stripe {
    return new Stripe(this.requiredSecret("STRIPE_SECRET_KEY", "sk_test_"));
  }

  private requiredSecret(name: string, prefix: string): string {
    const value = process.env[name]?.trim();
    if (!value || !value.startsWith(prefix) || value.includes("change_me")) {
      throw new ServiceUnavailableException(`${name} n'est pas configure pour le mode test.`);
    }
    return value;
  }
}

export function checkoutMatchesPayment(
  payment: { caseId: string; amountCents: number; currency: string; stripeCheckoutSession: string | null },
  session: Pick<Stripe.Checkout.Session, "id" | "amount_total" | "currency" | "metadata">,
): boolean {
  return session.metadata?.caseId === payment.caseId
    && payment.stripeCheckoutSession === session.id
    && session.amount_total === payment.amountCents
    && session.currency === payment.currency;
}
