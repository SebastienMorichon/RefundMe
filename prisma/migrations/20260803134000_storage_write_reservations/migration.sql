CREATE TABLE "StorageWriteReservation" (
    "id" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "storageBucket" TEXT,
    "storageKey" TEXT,
    "checksumSha256" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "objectDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageWriteReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StorageWriteReservation_sizeBytes_positive" CHECK ("sizeBytes" > 0),
    CONSTRAINT "StorageWriteReservation_purpose_allowed" CHECK (
        "purpose" IN ('USER_UPLOAD', 'GENERATED_PACKET', 'DOCUMENT_REVISION')
    ),
    CONSTRAINT "StorageWriteReservation_reference_complete" CHECK (
        ("storageBucket" IS NULL AND "storageKey" IS NULL AND "checksumSha256" IS NULL)
        OR
        (
            "storageBucket" IS NOT NULL
            AND length("storageBucket") BETWEEN 1 AND 255
            AND "storageKey" IS NOT NULL
            AND length("storageKey") BETWEEN 1 AND 1024
            AND "checksumSha256" IS NOT NULL
            AND "checksumSha256" ~ '^[0-9a-f]{64}$'
        )
    )
);

CREATE INDEX "StorageWriteReservation_expiresAt_idx"
ON "StorageWriteReservation"("expiresAt");

CREATE UNIQUE INDEX "StorageWriteReservation_storageBucket_storageKey_key"
ON "StorageWriteReservation"("storageBucket", "storageKey");

-- Upload reservations are short leases; no durable customer data is lost by
-- invalidating leases that predate this staging/outbox mechanism.
DELETE FROM "DocumentUploadReservation";

ALTER TABLE "DocumentUploadReservation"
ADD COLUMN "storageWriteReservationId" TEXT NOT NULL;

CREATE UNIQUE INDEX "DocumentUploadReservation_storageWriteReservationId_key"
ON "DocumentUploadReservation"("storageWriteReservationId");

ALTER TABLE "DocumentUploadReservation"
ADD CONSTRAINT "DocumentUploadReservation_storageWriteReservationId_fkey"
FOREIGN KEY ("storageWriteReservationId") REFERENCES "StorageWriteReservation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
