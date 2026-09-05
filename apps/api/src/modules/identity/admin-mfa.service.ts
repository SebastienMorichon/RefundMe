import { Injectable } from "@nestjs/common";
import { IdentityTokenPurpose, Prisma, type UserRole } from "@prisma/client";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { readAuthenticationSecret } from "./authentication-secret";
import { decodeBase32, MfaSecretService } from "./mfa-secret.service";
import { PersistentAuthBudgetService } from "./persistent-auth-budget.service";

const challengeLifetimeMs = 5 * 60 * 1_000;
const maximumChallengeAttempts = 5;
const rawChallengePattern = /^[A-Za-z0-9_-]{43}$/;
const otpPattern = /^\d{6}$/;

export type AdminMfaChallenge = Readonly<{
  challengeToken: string;
  expiresInSeconds: number;
}>;

export type MfaVerifiedAdmin = Readonly<{
  id: string;
  email: string;
  role: UserRole;
}>;

export class AdminMfaNotConfiguredError extends Error {
  constructor() {
    super("Administrator MFA is not configured");
    this.name = "AdminMfaNotConfiguredError";
  }
}

export class InvalidAdminMfaError extends Error {
  constructor() {
    super("Invalid administrator MFA challenge");
    this.name = "InvalidAdminMfaError";
  }
}

class MfaVerificationRaceError extends Error {}

@Injectable()
export class AdminMfaService {
  private readonly authenticationSecret = readAuthenticationSecret();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: MfaSecretService,
    private readonly budgets: PersistentAuthBudgetService,
  ) {}

  async createLoginChallenge(userId: string): Promise<AdminMfaChallenge> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        emailVerifiedAt: true,
        accountDeletedAt: true,
        mfaEnabledAt: true,
        mfaSecretEncrypted: true,
      },
    });
    if (
      !user ||
      user.role !== "ADMIN" ||
      !user.emailVerifiedAt ||
      user.accountDeletedAt ||
      !user.mfaEnabledAt ||
      !user.mfaSecretEncrypted
    ) {
      throw new AdminMfaNotConfiguredError();
    }
    await this.budgets.consume("MFA_CHALLENGE", userId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + challengeLifetimeMs);
    const challengeToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashChallenge(challengeToken);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`identity-admin-mfa:${userId}`}, 0)
        )
      `);
      await transaction.identityToken.updateMany({
        where: {
          userId,
          purpose: IdentityTokenPurpose.ADMIN_MFA_LOGIN,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      const challenge = await transaction.identityToken.create({
        data: {
          userId,
          purpose: IdentityTokenPurpose.ADMIN_MFA_LOGIN,
          tokenHash,
          expiresAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: userId,
          action: "ADMIN_MFA_CHALLENGE_ISSUED",
          entityType: "User",
          entityId: userId,
          metadata: {
            challengeId: challenge.id,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
    });
    return {
      challengeToken,
      expiresInSeconds: challengeLifetimeMs / 1_000,
    };
  }

  async verifyLoginChallenge(
    rawChallenge: string,
    code: string,
    now = new Date(),
  ): Promise<MfaVerifiedAdmin> {
    if (!rawChallengePattern.test(rawChallenge)) {
      throw new InvalidAdminMfaError();
    }
    const tokenHash = this.hashChallenge(rawChallenge);
    const challenge = await this.prisma.identityToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            emailVerifiedAt: true,
            accountDeletedAt: true,
            mfaEnabledAt: true,
            mfaSecretEncrypted: true,
            mfaLastUsedStep: true,
          },
        },
      },
    });
    if (!isUsableChallenge(challenge, now)) {
      throw new InvalidAdminMfaError();
    }

    let matchedStep: bigint | null = null;
    if (otpPattern.test(code)) {
      try {
        const secret = this.secrets.decrypt(
          challenge.user.id,
          challenge.user.mfaSecretEncrypted,
        );
        matchedStep = findMatchingTotpStep(secret, code, now);
      } catch {
        matchedStep = null;
      }
    }
    if (matchedStep === null) {
      await this.recordFailure(challenge.id, challenge.userId, now);
      throw new InvalidAdminMfaError();
    }

    try {
      const admin = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.identityToken.findUnique({
          where: { tokenHash },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                emailVerifiedAt: true,
                accountDeletedAt: true,
                mfaEnabledAt: true,
                mfaSecretEncrypted: true,
                mfaLastUsedStep: true,
              },
            },
          },
        });
        if (!isUsableChallenge(current, now)) return null;
        if (
          current.user.mfaSecretEncrypted !== challenge.user.mfaSecretEncrypted
        ) {
          return null;
        }

        const advanced = await transaction.user.updateMany({
          where: {
            id: current.userId,
            role: "ADMIN",
            emailVerifiedAt: { not: null },
            mfaEnabledAt: { not: null },
            mfaSecretEncrypted: current.user.mfaSecretEncrypted,
            accountDeletedAt: null,
            OR: [
              { mfaLastUsedStep: null },
              { mfaLastUsedStep: { lt: matchedStep } },
            ],
          },
          data: { mfaLastUsedStep: matchedStep },
        });
        if (advanced.count !== 1) return null;

        const consumed = await transaction.identityToken.updateMany({
          where: {
            id: current.id,
            usedAt: null,
            attempts: { lt: maximumChallengeAttempts },
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) throw new MfaVerificationRaceError();

        await transaction.identityToken.updateMany({
          where: {
            userId: current.userId,
            purpose: IdentityTokenPurpose.ADMIN_MFA_LOGIN,
            usedAt: null,
          },
          data: { usedAt: now },
        });
        await transaction.auditLog.create({
          data: {
            actorId: current.userId,
            action: "ADMIN_MFA_LOGIN_VERIFIED",
            entityType: "User",
            entityId: current.userId,
            metadata: {
              challengeId: current.id,
              totpStep: matchedStep.toString(),
              verifiedAt: now.toISOString(),
            },
          },
        });
        return {
          id: current.user.id,
          email: current.user.email,
          role: current.user.role,
        };
      });
      if (!admin) throw new InvalidAdminMfaError();
      return admin;
    } catch (error) {
      if (error instanceof InvalidAdminMfaError) throw error;
      if (error instanceof MfaVerificationRaceError) {
        throw new InvalidAdminMfaError();
      }
      throw error;
    }
  }

  private async recordFailure(
    challengeId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const incremented = await transaction.identityToken.updateMany({
        where: {
          id: challengeId,
          userId,
          purpose: IdentityTokenPurpose.ADMIN_MFA_LOGIN,
          usedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: maximumChallengeAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      if (incremented.count !== 1) return;

      const locked = await transaction.identityToken.updateMany({
        where: {
          id: challengeId,
          usedAt: null,
          attempts: { gte: maximumChallengeAttempts },
        },
        data: { usedAt: now },
      });
      if (locked.count === 1) {
        await transaction.auditLog.create({
          data: {
            actorId: userId,
            action: "ADMIN_MFA_CHALLENGE_LOCKED",
            entityType: "User",
            entityId: userId,
            metadata: { challengeId, lockedAt: now.toISOString() },
          },
        });
      }
    });
  }

  private hashChallenge(value: string): string {
    return createHmac("sha256", this.authenticationSecret)
      .update("lydoc-admin-mfa-challenge-v1\0")
      .update(value)
      .digest("hex");
  }
}

export function generateTotpCode(secret: string, step: bigint): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    (((digest[offset]! & 0x7f) << 24) |
      (digest[offset + 1]! << 16) |
      (digest[offset + 2]! << 8) |
      digest[offset + 3]!) >>>
    0;
  return String(binary % 1_000_000).padStart(6, "0");
}

function findMatchingTotpStep(
  secret: string,
  candidate: string,
  now: Date,
): bigint | null {
  const current = BigInt(Math.floor(now.getTime() / 30_000));
  const steps = [current, current - 1n, current + 1n];
  const candidateBuffer = Buffer.from(candidate, "ascii");
  for (const step of steps) {
    if (step < 0n) continue;
    const expected = Buffer.from(generateTotpCode(secret, step), "ascii");
    if (
      expected.length === candidateBuffer.length &&
      timingSafeEqual(expected, candidateBuffer)
    ) {
      return step;
    }
  }
  return null;
}

function isUsableChallenge(
  challenge: {
    purpose: IdentityTokenPurpose;
    usedAt: Date | null;
    attempts: number;
    expiresAt: Date;
    user: {
      role: UserRole;
      emailVerifiedAt: Date | null;
      accountDeletedAt: Date | null;
      mfaEnabledAt: Date | null;
      mfaSecretEncrypted: string | null;
    };
  } | null,
  now: Date,
): challenge is NonNullable<typeof challenge> & {
  user: { mfaSecretEncrypted: string };
} {
  return Boolean(
    challenge &&
    challenge.purpose === IdentityTokenPurpose.ADMIN_MFA_LOGIN &&
    !challenge.usedAt &&
    challenge.attempts < maximumChallengeAttempts &&
    challenge.expiresAt.getTime() > now.getTime() &&
    challenge.user.role === "ADMIN" &&
    challenge.user.emailVerifiedAt &&
    !challenge.user.accountDeletedAt &&
    challenge.user.mfaEnabledAt &&
    challenge.user.mfaSecretEncrypted,
  );
}
