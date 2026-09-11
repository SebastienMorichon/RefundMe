-- Keep the legacy Stripe columns so existing payment records remain auditable.
CREATE TYPE "DiscountType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');

ALTER TABLE "Payment"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'stripe',
  ADD COLUMN "providerCheckoutId" TEXT,
  ADD COLUMN "providerReference" TEXT,
  ADD COLUMN "providerTransactionId" TEXT,
  ADD COLUMN "serviceFeeCents" INTEGER,
  ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discountLabel" TEXT,
  ADD COLUMN "promoCode" TEXT;

ALTER TABLE "PricingConfiguration"
  ADD COLUMN "paymentEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "promotionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "promotionLabel" TEXT,
  ADD COLUMN "promotionDiscountType" "DiscountType",
  ADD COLUMN "promotionDiscountValue" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "promotionStartsAt" TIMESTAMP(3),
  ADD COLUMN "promotionEndsAt" TIMESTAMP(3);

ALTER TABLE "PricingConfiguration"
  ADD COLUMN "managedPostageCents" INTEGER NOT NULL DEFAULT 160;

ALTER TABLE "PricingConfiguration"
  ALTER COLUMN "serviceFeeCents" SET DEFAULT 99;

-- Adopt the launch tariff only when the row still contains the former defaults.
UPDATE "PricingConfiguration"
SET
  "serviceFeeCents" = 99,
  "printingBaseCents" = 30,
  "printingPerAdditionalPageCents" = 30,
  "greenLetterCents" = 152,
  "defaultPostalProduct" = 'verte'
WHERE "id" = 'default'
  AND "serviceFeeCents" = 299
  AND "printingBaseCents" = 90
  AND "printingPerAdditionalPageCents" = 31;

CREATE TABLE "PromoCode" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "discountType" "DiscountType" NOT NULL,
  "discountValue" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");
CREATE INDEX "PromoCode_enabled_startsAt_endsAt_idx" ON "PromoCode"("enabled", "startsAt", "endsAt");
CREATE UNIQUE INDEX "Payment_providerCheckoutId_key" ON "Payment"("providerCheckoutId");
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "Payment"("providerReference");
