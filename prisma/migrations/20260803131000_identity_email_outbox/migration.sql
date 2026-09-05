CREATE TABLE "IdentityEmailOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "rawTokenEncrypted" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockId" VARCHAR(64),
    "sentAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "failureCode" VARCHAR(48),
    "providerMessageId" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityEmailOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IdentityEmailOutbox_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 20),
    CONSTRAINT "IdentityEmailOutbox_terminal_state_check" CHECK (NOT ("sentAt" IS NOT NULL AND "deadLetteredAt" IS NOT NULL)),
    CONSTRAINT "IdentityEmailOutbox_lock_pair_check" CHECK (("lockedAt" IS NULL) = ("lockId" IS NULL))
);

CREATE UNIQUE INDEX "IdentityEmailOutbox_tokenId_key"
  ON "IdentityEmailOutbox"("tokenId");
CREATE INDEX "IdentityEmailOutbox_sentAt_deadLetteredAt_availableAt_idx"
  ON "IdentityEmailOutbox"("sentAt", "deadLetteredAt", "availableAt");
CREATE INDEX "IdentityEmailOutbox_lockedAt_idx"
  ON "IdentityEmailOutbox"("lockedAt");

ALTER TABLE "IdentityEmailOutbox"
  ADD CONSTRAINT "IdentityEmailOutbox_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdentityEmailOutbox"
  ADD CONSTRAINT "IdentityEmailOutbox_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "IdentityToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
