import { Injectable } from "@nestjs/common";
import { IdentityTokenPurpose, type UserRole } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { readAuthenticationSecret } from "./authentication-secret";
import { IdentityEmailOutboxService } from "./identity-email-outbox.service";
import { NodePasswordHasher } from "./node-password-hasher.service";
import { PersistentAuthBudgetService } from "./persistent-auth-budget.service";

const rawTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const emailVerificationLifetimeMs = 24 * 60 * 60 * 1_000;
const passwordResetLifetimeMs = 30 * 60 * 1_000;
const tokenIssueCooldownMs = 60 * 1_000;

export type TestOnlyIdentityToken = Readonly<{
  testOnlyToken?: string;
}>;

export type VerifiedIdentity = Readonly<{
  id: string;
  email: string;
  role: UserRole;
}>;

export class InvalidIdentityTokenError extends Error {
  constructor() {
    super("Invalid or expired identity token");
    this.name = "InvalidIdentityTokenError";
  }
}

export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super("Invalid current password");
    this.name = "InvalidCurrentPasswordError";
  }
}

export class PasswordReuseError extends Error {
  constructor() {
    super("The new password must be different");
    this.name = "PasswordReuseError";
  }
}

@Injectable()
export class IdentityTokenService {
  private readonly secret = readAuthenticationSecret();

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: NodePasswordHasher,
    private readonly emailOutbox: IdentityEmailOutboxService,
    private readonly budgets: PersistentAuthBudgetService,
  ) {}

  async issueEmailVerification(userId: string): Promise<TestOnlyIdentityToken> {
    await this.budgets.consume("REGISTER", userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        accountDeletedAt: true,
      },
    });
    if (!user || user.emailVerifiedAt || user.accountDeletedAt) return {};
    return this.issueToken(user, IdentityTokenPurpose.EMAIL_VERIFICATION);
  }

  async requestRegistrationVerification(
    email: string,
  ): Promise<TestOnlyIdentityToken> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        accountDeletedAt: true,
      },
    });
    if (!user || user.emailVerifiedAt || user.accountDeletedAt) return {};
    return this.issueToken(user, IdentityTokenPurpose.EMAIL_VERIFICATION);
  }

  async requestEmailVerification(
    email: string | null,
  ): Promise<TestOnlyIdentityToken> {
    await this.budgets.consume("RESEND", email);
    const user = await this.prisma.user.findUnique({
      where: { email: email ?? "invalid-identity-address@invalid.local" },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        accountDeletedAt: true,
      },
    });
    if (!user || user.emailVerifiedAt || user.accountDeletedAt) return {};
    return this.issueToken(user, IdentityTokenPurpose.EMAIL_VERIFICATION);
  }

  async verifyEmail(
    rawToken: string,
    password: string,
    consentVersion: string,
    consentedAt: Date,
  ): Promise<VerifiedIdentity> {
    assertRawToken(rawToken);
    const now = new Date();
    const tokenHash = this.hashToken(
      rawToken,
      IdentityTokenPurpose.EMAIL_VERIFICATION,
    );
    if (
      !(await this.isUsableToken(
        tokenHash,
        IdentityTokenPurpose.EMAIL_VERIFICATION,
        now,
      ))
    ) {
      throw new InvalidIdentityTokenError();
    }
    const passwordHash = await this.passwordHasher.hash(password);
    const verified = await this.prisma.$transaction(async (transaction) => {
      const token = await transaction.identityToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              emailVerifiedAt: true,
              accountDeletedAt: true,
            },
          },
        },
      });
      if (
        !token ||
        token.purpose !== IdentityTokenPurpose.EMAIL_VERIFICATION ||
        token.usedAt ||
        token.expiresAt.getTime() <= now.getTime() ||
        token.user.accountDeletedAt
      ) {
        return null;
      }
      const consumed = await transaction.identityToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return null;

      await transaction.identityToken.updateMany({
        where: {
          userId: token.userId,
          purpose: IdentityTokenPurpose.EMAIL_VERIFICATION,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      if (token.user.emailVerifiedAt) return null;

      const activated = await transaction.user.updateMany({
        where: {
          id: token.userId,
          emailVerifiedAt: null,
          accountDeletedAt: null,
        },
        data: {
          passwordHash,
          emailVerifiedAt: now,
          consentVersion,
          consentedAt,
        },
      });
      if (activated.count !== 1) return null;
      const user = await transaction.user.findUnique({
        where: { id: token.userId },
        select: { id: true, email: true, role: true },
      });
      if (!user) return null;
      await transaction.auditLog.createMany({
        data: [
          {
            actorId: user.id,
            action: "EMAIL_VERIFIED",
            entityType: "User",
            entityId: user.id,
            metadata: { tokenId: token.id, verifiedAt: now.toISOString() },
          },
          {
            actorId: user.id,
            action: "LEGAL_CONSENT_RECORDED",
            entityType: "User",
            entityId: user.id,
            metadata: {
              version: consentVersion,
              acceptedAt: consentedAt.toISOString(),
              evidence: "VERIFIED_EMAIL_ACTIVATION",
            },
          },
        ],
      });
      return user;
    });
    if (!verified) throw new InvalidIdentityTokenError();
    return verified;
  }

  async requestPasswordReset(
    email: string | null,
  ): Promise<TestOnlyIdentityToken> {
    await this.budgets.consume("FORGOT_PASSWORD", email);
    const user = await this.prisma.user.findUnique({
      where: { email: email ?? "invalid-identity-address@invalid.local" },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        accountDeletedAt: true,
      },
    });
    if (!user?.emailVerifiedAt || user.accountDeletedAt) return {};
    return this.issueToken(user, IdentityTokenPurpose.PASSWORD_RESET);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    assertRawToken(rawToken);
    const now = new Date();
    const tokenHash = this.hashToken(
      rawToken,
      IdentityTokenPurpose.PASSWORD_RESET,
    );
    if (
      !(await this.isUsableToken(
        tokenHash,
        IdentityTokenPurpose.PASSWORD_RESET,
        now,
      ))
    ) {
      throw new InvalidIdentityTokenError();
    }
    const passwordHash = await this.passwordHasher.hash(newPassword);
    const reset = await this.prisma.$transaction(async (transaction) => {
      const token = await transaction.identityToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              id: true,
              emailVerifiedAt: true,
              passwordHash: true,
              accountDeletedAt: true,
            },
          },
        },
      });
      if (
        !token ||
        token.purpose !== IdentityTokenPurpose.PASSWORD_RESET ||
        token.usedAt ||
        token.expiresAt.getTime() <= now.getTime() ||
        token.user.accountDeletedAt
      ) {
        return false;
      }
      const consumed = await transaction.identityToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1 || !token.user.emailVerifiedAt) return false;

      const updated = await transaction.user.updateMany({
        where: {
          id: token.userId,
          passwordHash: token.user.passwordHash,
          accountDeletedAt: null,
        },
        data: { passwordHash },
      });
      if (updated.count !== 1) return false;
      await transaction.userSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.identityToken.updateMany({
        where: {
          userId: token.userId,
          purpose: IdentityTokenPurpose.PASSWORD_RESET,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: token.userId,
          action: "PASSWORD_RESET_COMPLETED",
          entityType: "User",
          entityId: token.userId,
          metadata: { tokenId: token.id, resetAt: now.toISOString() },
        },
      });
      return true;
    });
    if (!reset) throw new InvalidIdentityTokenError();
  }

  async changePassword(input: {
    userId: string;
    currentSessionId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { passwordHash: true, accountDeletedAt: true },
    });
    const matches = await this.passwordHasher.verifyWithDummy(
      input.currentPassword,
      user?.passwordHash,
    );
    if (!user || user.accountDeletedAt || !matches) {
      throw new InvalidCurrentPasswordError();
    }
    if (input.currentPassword === input.newPassword) {
      throw new PasswordReuseError();
    }

    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: {
          id: input.userId,
          passwordHash: user.passwordHash,
          accountDeletedAt: null,
        },
        data: { passwordHash },
      });
      if (updated.count !== 1) throw new InvalidCurrentPasswordError();

      await transaction.userSession.updateMany({
        where: {
          userId: input.userId,
          id: { not: input.currentSessionId },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.identityToken.updateMany({
        where: {
          userId: input.userId,
          purpose: IdentityTokenPurpose.PASSWORD_RESET,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.userId,
          action: "PASSWORD_CHANGED",
          entityType: "User",
          entityId: input.userId,
          metadata: { changedAt: now.toISOString() },
        },
      });
    });
  }

  private async issueToken(
    user: { id: string; email: string },
    purpose: IdentityTokenPurpose,
  ): Promise<TestOnlyIdentityToken> {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
        (purpose === IdentityTokenPurpose.EMAIL_VERIFICATION
          ? emailVerificationLifetimeMs
          : passwordResetLifetimeMs),
    );
    const recent = await this.prisma.identityToken.findFirst({
      where: {
        userId: user.id,
        purpose,
        usedAt: null,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - tokenIssueCooldownMs) },
      },
      select: { id: true },
    });
    if (recent) return {};
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(rawToken, purpose);
    const token = await this.prisma.$transaction(async (transaction) => {
      const recent = await transaction.identityToken.findFirst({
        where: {
          userId: user.id,
          purpose,
          usedAt: null,
          expiresAt: { gt: now },
          createdAt: { gt: new Date(now.getTime() - tokenIssueCooldownMs) },
        },
        select: { id: true },
      });
      if (recent) return null;

      const created = await transaction.identityToken.create({
        data: {
          userId: user.id,
          purpose,
          tokenHash,
          expiresAt,
        },
      });
      await this.emailOutbox.enqueue(transaction, {
        userId: user.id,
        tokenId: created.id,
        rawToken,
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "IDENTITY_TOKEN_ISSUED",
          entityType: "User",
          entityId: user.id,
          metadata: {
            purpose,
            tokenId: created.id,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return created;
    });
    if (!token) return {};
    this.emailOutbox.kick();
    return canExposeIdentityTokens() ? { testOnlyToken: rawToken } : {};
  }

  private hashToken(rawToken: string, purpose: IdentityTokenPurpose): string {
    return createHmac("sha256", this.secret)
      .update("lydoc-identity-token-v1\0")
      .update(purpose)
      .update("\0")
      .update(rawToken)
      .digest("hex");
  }

  private async isUsableToken(
    tokenHash: string,
    purpose: IdentityTokenPurpose,
    now: Date,
  ): Promise<boolean> {
    const token = await this.prisma.identityToken.findUnique({
      where: { tokenHash },
      select: {
        purpose: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { accountDeletedAt: true } },
      },
    });
    return Boolean(
      token &&
      token.purpose === purpose &&
      !token.usedAt &&
      !token.user.accountDeletedAt &&
      token.expiresAt.getTime() > now.getTime(),
    );
  }
}

export function canExposeIdentityTokens(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.AUTH_EXPOSE_TEST_TOKENS === "true"
  );
}

function assertRawToken(value: string): void {
  if (!rawTokenPattern.test(value)) throw new InvalidIdentityTokenError();
}
