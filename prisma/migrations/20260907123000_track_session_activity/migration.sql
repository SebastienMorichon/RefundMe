ALTER TABLE "UserSession"
ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "UserSession_lastSeenAt_idx"
ON "UserSession"("lastSeenAt");

CREATE INDEX "User_role_accountDeletedAt_createdAt_idx"
ON "User"("role", "accountDeletedAt", "createdAt");

CREATE INDEX "AdministrativeCase_ownerId_status_idx"
ON "AdministrativeCase"("ownerId", "status");
