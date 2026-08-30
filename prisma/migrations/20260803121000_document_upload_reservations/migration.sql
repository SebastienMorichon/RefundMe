CREATE TABLE "DocumentUploadReservation" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentUploadReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentUploadReservation_ownerId_expiresAt_idx"
  ON "DocumentUploadReservation"("ownerId", "expiresAt");
CREATE INDEX "DocumentUploadReservation_expiresAt_idx"
  ON "DocumentUploadReservation"("expiresAt");

ALTER TABLE "DocumentUploadReservation"
  ADD CONSTRAINT "DocumentUploadReservation_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
