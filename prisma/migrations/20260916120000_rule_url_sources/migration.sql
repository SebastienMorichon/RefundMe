ALTER TABLE "GameRule"
ALTER COLUMN "sourceDocumentId" DROP NOT NULL;

ALTER TABLE "GameRule"
ADD COLUMN "sourceUrl" VARCHAR(2048),
ADD COLUMN "sourceKey" CHAR(64),
ADD COLUMN "sourceFingerprint" CHAR(64);

CREATE UNIQUE INDEX "GameRule_sourceKey_key" ON "GameRule"("sourceKey");

ALTER TABLE "GameRule"
ADD CONSTRAINT "GameRule_source_required"
CHECK ("sourceDocumentId" IS NOT NULL OR "sourceUrl" IS NOT NULL);
