CREATE TYPE "ContactDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "ContactSubmission" (
  "id" TEXT NOT NULL,
  "emailHash" CHAR(64) NOT NULL,
  "clientHash" CHAR(64) NOT NULL,
  "status" "ContactDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactSubmission_status_createdAt_idx"
  ON "ContactSubmission"("status", "createdAt");
CREATE INDEX "ContactSubmission_emailHash_status_createdAt_idx"
  ON "ContactSubmission"("emailHash", "status", "createdAt");
CREATE INDEX "ContactSubmission_clientHash_status_createdAt_idx"
  ON "ContactSubmission"("clientHash", "status", "createdAt");
