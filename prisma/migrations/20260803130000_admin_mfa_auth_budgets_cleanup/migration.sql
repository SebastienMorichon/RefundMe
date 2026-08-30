-- MFA challenges reuse the existing opaque, hashed identity-token store.
ALTER TYPE "IdentityTokenPurpose" ADD VALUE 'ADMIN_MFA_LOGIN';

ALTER TABLE "User"
  ADD COLUMN "mfaSecretEncrypted" TEXT,
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
  ADD COLUMN "mfaLastUsedStep" BIGINT;

ALTER TABLE "UserSession"
  ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);

ALTER TABLE "IdentityToken"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "IdentityToken_attempts_nonnegative_check"
    CHECK ("attempts" >= 0);

-- Legacy administrators were created before MFA existed. Fail closed and force
-- an explicit, audited CLI reprovisioning rather than preserving unsafe access.
INSERT INTO "AuditLog" (
  "id", "actorId", "action", "entityType", "entityId", "metadata"
)
SELECT
  'mfa-migration-' || "id",
  "id",
  'ADMIN_DEMOTED_FOR_MFA_MIGRATION',
  'User',
  "id",
  jsonb_build_object('previousRole', 'ADMIN', 'reason', 'MFA_REQUIRED')
FROM "User"
WHERE "role" = 'ADMIN';

UPDATE "User"
SET "role" = 'USER'
WHERE "role" = 'ADMIN';

ALTER TABLE "User"
  ADD CONSTRAINT "User_mfa_pair_check" CHECK (
    (
      "mfaSecretEncrypted" IS NULL AND
      "mfaEnabledAt" IS NULL AND
      "mfaLastUsedStep" IS NULL
    ) OR (
      "mfaSecretEncrypted" IS NOT NULL AND
      "mfaEnabledAt" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "User_admin_mfa_required_check" CHECK (
    "role" <> 'ADMIN' OR (
      "emailVerifiedAt" IS NOT NULL AND
      "mfaSecretEncrypted" IS NOT NULL AND
      "mfaEnabledAt" IS NOT NULL
    )
  );

CREATE INDEX "User_emailVerifiedAt_createdAt_idx"
  ON "User"("emailVerifiedAt", "createdAt");

CREATE TABLE "AuthBudgetBucket" (
  "key" VARCHAR(96) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AuthBudgetBucket_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "AuthBudgetBucket_count_nonnegative_check" CHECK ("count" >= 0)
);

CREATE INDEX "AuthBudgetBucket_expiresAt_idx"
  ON "AuthBudgetBucket"("expiresAt");
