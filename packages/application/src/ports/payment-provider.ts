export type CheckoutSessionInput = Readonly<{
  caseId: string;
  userId: string;
  amountCents: number;
  currency: "eur";
  successUrl: string;
  cancelUrl: string;
}>;

export type CheckoutSession = Readonly<{
  id: string;
  url: string;
}>;

export type PaymentWebhookInput = Readonly<{
  payload: string;
  signature: string;
}>;

export type VerifiedPaymentEvent = Readonly<{
  providerEventId: string;
  caseId: string;
  paid: boolean;
}>;

export interface PaymentProvider {
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
  verifyWebhook(input: PaymentWebhookInput): Promise<VerifiedPaymentEvent>;
}

