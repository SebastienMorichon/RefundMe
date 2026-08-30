-- Public registration now records the accepted legal version and always creates
-- a regular user. Existing accounts remain nullable and can be migrated through
-- a separate re-consent flow without inventing consent evidence.
ALTER TABLE "User"
  ADD COLUMN "consentVersion" VARCHAR(64),
  ADD COLUMN "consentedAt" TIMESTAMP(3),
  ADD CONSTRAINT "User_consent_pair_check" CHECK (
    ("consentVersion" IS NULL AND "consentedAt" IS NULL) OR
    ("consentVersion" IS NOT NULL AND "consentedAt" IS NOT NULL)
  );

-- Opaque session tokens are stored only as keyed hashes and can be revoked
-- individually or in bulk. Deleting a user invalidates all of their sessions.
CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSession_tokenHash_key"
  ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_revokedAt_expiresAt_idx"
  ON "UserSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "UserSession_expiresAt_idx"
  ON "UserSession"("expiresAt");

ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
