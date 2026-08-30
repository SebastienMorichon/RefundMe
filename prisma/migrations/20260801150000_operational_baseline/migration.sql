-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('GAME_RULE_PDF', 'ORANGE_INVOICE', 'IDENTITY_DOCUMENT', 'BANK_DETAILS', 'TRAIN_TICKET', 'FLIGHT_TICKET', 'PURCHASE_PROOF', 'WARRANTY', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'OCR_PENDING', 'OCR_DONE', 'ANALYSIS_PENDING', 'ANALYZED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentValidationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'VALID', 'NEEDS_REVIEW', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'AI_EXTRACTED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'WAITING_FOR_USER_DOCUMENTS', 'READY_TO_PAY', 'PAID', 'GENERATED', 'PRINT_READY', 'SENT', 'REFUNDED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CaseFulfillmentMode" AS ENUM ('SELF_SERVICE', 'MANAGED_POSTAL');

-- CreateEnum
CREATE TYPE "PostalShipmentStatus" AS ENUM ('DRAFT', 'QUOTED', 'SUBMITTING', 'SUBMITTED', 'PRODUCED', 'HANDED_OVER', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "firstName" TEXT,
    "lastName" TEXT,
    "postalAddress" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT,
    "phoneNumber" TEXT,
    "operatorCustomerReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "watermarked" BOOLEAN NOT NULL DEFAULT false,
    "watermarkVersion" TEXT,
    "watermarkReference" TEXT,
    "watermarkedAt" TIMESTAMP(3),
    "validationStatus" "DocumentValidationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "validationProvider" TEXT,
    "validationResultJson" JSONB,
    "validationConfidence" DECIMAL(5,4),
    "validatedAt" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "replacedByDocumentId" TEXT,
    "retentionExpiresAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analyzedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentStorageRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentStorageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrResult" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "confidence" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAnalysis" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "confidence" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organizer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organizer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRule" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "reimbursementCents" INTEGER NOT NULL,
    "requiredDocuments" JSONB NOT NULL,
    "constraintsJson" JSONB NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdministrativeCase" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "gameRuleId" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "estimatedRecoverableCents" INTEGER NOT NULL,
    "serviceFeeCents" INTEGER NOT NULL DEFAULT 299,
    "confidence" DECIMAL(5,4),
    "complianceSnapshotJson" JSONB NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "validationSnapshotJson" JSONB,
    "fulfillmentMode" "CaseFulfillmentMode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdministrativeCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDocument" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "stripeCheckoutSession" TEXT,
    "stripePaymentIntent" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedPacket" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedPacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostalShipment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "product" TEXT NOT NULL DEFAULT 'vertesuivi',
    "status" "PostalShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "providerUid" TEXT,
    "postageCents" INTEGER NOT NULL DEFAULT 0,
    "printingCents" INTEGER NOT NULL DEFAULT 0,
    "providerPostageCents" INTEGER NOT NULL DEFAULT 0,
    "providerServiceCents" INTEGER NOT NULL DEFAULT 0,
    "providerTotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "pricingSnapshotJson" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "previewUrl" TEXT,
    "trackingNumber" TEXT,
    "proofOfDepositUrl" TEXT,
    "providerRequestId" TEXT,
    "lastEventJson" JSONB,
    "errorMessage" TEXT,
    "quotedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "producedAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "trackingUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostalShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "caseId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingConfiguration" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "serviceFeeCents" INTEGER NOT NULL DEFAULT 299,
    "printingBaseCents" INTEGER NOT NULL DEFAULT 90,
    "printingPerAdditionalPageCents" INTEGER NOT NULL DEFAULT 31,
    "greenLetterCents" INTEGER NOT NULL DEFAULT 152,
    "trackedGreenLetterCents" INTEGER NOT NULL DEFAULT 202,
    "defaultPostalProduct" TEXT NOT NULL DEFAULT 'vertesuivi',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "DocumentStorageRevision_expiresAt_deletedAt_idx" ON "DocumentStorageRevision"("expiresAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OcrResult_documentId_key" ON "OcrResult"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Organizer_slug_key" ON "Organizer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDocument_caseId_documentId_purpose_key" ON "CaseDocument"("caseId", "documentId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_caseId_key" ON "Payment"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "PostalShipment_caseId_key" ON "PostalShipment"("caseId");

-- CreateIndex
CREATE INDEX "PostalShipment_provider_providerUid_idx" ON "PostalShipment"("provider", "providerUid");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_eventKey_key" ON "NotificationDelivery"("eventKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentStorageRevision" ADD CONSTRAINT "DocumentStorageRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrResult" ADD CONSTRAINT "OcrResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnalysis" ADD CONSTRAINT "DocumentAnalysis_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRule" ADD CONSTRAINT "GameRule_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRule" ADD CONSTRAINT "GameRule_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeCase" ADD CONSTRAINT "AdministrativeCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeCase" ADD CONSTRAINT "AdministrativeCase_gameRuleId_fkey" FOREIGN KEY ("gameRuleId") REFERENCES "GameRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdministrativeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdministrativeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedPacket" ADD CONSTRAINT "GeneratedPacket_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdministrativeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostalShipment" ADD CONSTRAINT "PostalShipment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdministrativeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdministrativeCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
