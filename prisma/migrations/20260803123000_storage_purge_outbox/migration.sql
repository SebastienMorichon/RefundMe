-- A generated packet is tombstoned before its encrypted blob is removed.
ALTER TABLE "GeneratedPacket" ADD COLUMN "purgeRequestedAt" TIMESTAMP(3);

CREATE INDEX "GeneratedPacket_purgeRequestedAt_createdAt_idx"
ON "GeneratedPacket"("purgeRequestedAt", "createdAt");

CREATE TYPE "StoragePurgeJobStatus" AS ENUM ('PENDING', 'OBJECT_DELETED');
CREATE TYPE "StoragePurgeEntityType" AS ENUM ('DOCUMENT', 'DOCUMENT_REVISION', 'GENERATED_PACKET');

-- This durable outbox remains the canonical reference to a blob between the
-- database tombstone, the idempotent physical delete and SQL finalization.
CREATE TABLE "StoragePurgeJob" (
    "id" TEXT NOT NULL,
    "groupType" VARCHAR(32) NOT NULL,
    "groupId" TEXT NOT NULL,
    "entityType" "StoragePurgeEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "StoragePurgeJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "objectDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoragePurgeJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoragePurgeJob_storageBucket_storageKey_key"
ON "StoragePurgeJob"("storageBucket", "storageKey");

CREATE INDEX "StoragePurgeJob_status_createdAt_idx"
ON "StoragePurgeJob"("status", "createdAt");

CREATE INDEX "StoragePurgeJob_groupType_groupId_status_idx"
ON "StoragePurgeJob"("groupType", "groupId", "status");
