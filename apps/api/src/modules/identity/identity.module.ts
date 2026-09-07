import { Module } from "@nestjs/common";
import { AccountDataRightsService } from "./account-data-rights.service";
import { IdentityController } from "./identity.controller";
import { AdminGuard } from "./admin.guard";
import { AuthGuard } from "./auth.guard";
import { AdminMfaService } from "./admin-mfa.service";
import { IdentityCleanupService } from "./identity-cleanup.service";
import { IdentityEmailService } from "./identity-email.service";
import { IdentityEmailOutboxService } from "./identity-email-outbox.service";
import { IdentityTokenService } from "./identity-token.service";
import { MfaSecretService } from "./mfa-secret.service";
import { NodePasswordHasher } from "./node-password-hasher.service";
import { PrismaUserRepository } from "./prisma-user.repository";
import { ProfileController } from "./profile.controller";
import { SessionService } from "./session.service";
import { PersistentAuthBudgetService } from "./persistent-auth-budget.service";
import { AdminClientsController } from "./admin-clients.controller";
import { AdminClientsService } from "./admin-clients.service";

@Module({
  controllers: [AdminClientsController, IdentityController, ProfileController],
  providers: [
    AccountDataRightsService,
    AdminClientsService,
    AdminGuard,
    AdminMfaService,
    AuthGuard,
    IdentityCleanupService,
    IdentityEmailService,
    IdentityEmailOutboxService,
    IdentityTokenService,
    MfaSecretService,
    PersistentAuthBudgetService,
    PrismaUserRepository,
    NodePasswordHasher,
    SessionService,
  ],
  exports: [AdminGuard, AuthGuard, PrismaUserRepository, SessionService],
})
export class IdentityModule {}
