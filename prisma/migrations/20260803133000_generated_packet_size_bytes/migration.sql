ALTER TABLE "GeneratedPacket"
ADD COLUMN "sizeBytes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GeneratedPacket"
ALTER COLUMN "sizeBytes" DROP DEFAULT;

ALTER TABLE "GeneratedPacket"
ADD CONSTRAINT "GeneratedPacket_sizeBytes_nonnegative"
CHECK ("sizeBytes" >= 0);
