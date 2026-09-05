-- Existing accounts predate the verification workflow. They are explicitly
-- grandfathered as verified at migration time so the release does not lock
-- out current users. New registrations remain NULL until token consumption.
ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

UPDATE "User"
SET "emailVerifiedAt" = CURRENT_TIMESTAMP
WHERE "emailVerifiedAt" IS NULL;

CREATE TYPE "IdentityTokenPurpose" AS ENUM (
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET'
);

CREATE TABLE "IdentityToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "IdentityTokenPurpose" NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IdentityToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityToken_tokenHash_key"
  ON "IdentityToken"("tokenHash");
CREATE INDEX "IdentityToken_userId_purpose_usedAt_expiresAt_idx"
  ON "IdentityToken"("userId", "purpose", "usedAt", "expiresAt");
CREATE INDEX "IdentityToken_expiresAt_idx"
  ON "IdentityToken"("expiresAt");

ALTER TABLE "IdentityToken"
  ADD CONSTRAINT "IdentityToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
