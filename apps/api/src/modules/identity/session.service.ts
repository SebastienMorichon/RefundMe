import { Injectable } from "@nestjs/common";
import type { UserRole } from "@prisma/client";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { readAuthenticationSecret } from "./authentication-secret";

const developmentSessionCookieName = "lydoc_session";
const productionSessionCookieName = "__Host-lydoc_session";
const developmentCsrfCookieName = "lydoc_csrf";
const productionCsrfCookieName = "__Host-lydoc_csrf";
const userSessionLifetimeSeconds = 7 * 24 * 60 * 60;
const csrfLifetimeSeconds = 60 * 60;
const sessionTokenBytes = 32;
const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const csrfTokenPattern = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;

export type SessionUser = Readonly<{
  id: string;
  email: string;
  role: UserRole;
}>;

export type AuthenticatedSession = Readonly<{
  id: string;
  mfaVerifiedAt: Date | null;
  user: SessionUser;
}>;

export type CreatedSession = AuthenticatedSession &
  Readonly<{
    cookieValue: string;
    expiresAt: Date;
    maxAgeSeconds: number;
  }>;

@Injectable()
export class SessionService {
  private readonly secret = readAuthenticationSecret();

  constructor(private readonly prisma: PrismaService) {}

  get cookieName(): string {
    return process.env.NODE_ENV === "production"
      ? productionSessionCookieName
      : developmentSessionCookieName;
  }

  get maxAgeSeconds(): number {
    return userSessionLifetimeSeconds;
  }

  get csrfCookieName(): string {
    return process.env.NODE_ENV === "production"
      ? productionCsrfCookieName
      : developmentCsrfCookieName;
  }

  get csrfMaxAgeSeconds(): number {
    return csrfLifetimeSeconds;
  }

  createCsrfToken(): string {
    const nonce = randomBytes(sessionTokenBytes).toString("base64url");
    return `${nonce}.${this.signCsrfNonce(nonce).toString("base64url")}`;
  }

  validateCsrfToken(
    cookieValue: string | undefined,
    headerValue: string | undefined,
  ): boolean {
    if (
      !cookieValue ||
      !headerValue ||
      !csrfTokenPattern.test(cookieValue) ||
      !csrfTokenPattern.test(headerValue)
    ) {
      return false;
    }

    const cookieBuffer = Buffer.from(cookieValue, "utf8");
    const headerBuffer = Buffer.from(headerValue, "utf8");
    if (
      cookieBuffer.length !== headerBuffer.length ||
      !timingSafeEqual(cookieBuffer, headerBuffer)
    ) {
      return false;
    }

    const [nonce, encodedSignature] = cookieValue.split(".");
    if (!nonce || !encodedSignature) return false;
    const signature = Buffer.from(encodedSignature, "base64url");
    if (signature.toString("base64url") !== encodedSignature) return false;
    const expectedSignature = this.signCsrfNonce(nonce);
    return (
      signature.length === expectedSignature.length &&
      timingSafeEqual(signature, expectedSignature)
    );
  }

  async createSession(
    userId: string,
    options: { mfaVerified?: boolean } = {},
  ): Promise<CreatedSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        emailVerifiedAt: true,
        accountDeletedAt: true,
        role: true,
        mfaEnabledAt: true,
        mfaSecretEncrypted: true,
      },
    });
    if (!user?.emailVerifiedAt || user.accountDeletedAt) {
      throw new Error("A verified e-mail is required before session creation.");
    }
    const admin = user.role === "ADMIN";
    if (
      admin &&
      (!user.mfaEnabledAt ||
        !user.mfaSecretEncrypted ||
        options.mfaVerified !== true)
    ) {
      throw new Error("Administrator MFA is required before session creation.");
    }

    const cookieValue = randomBytes(sessionTokenBytes).toString("base64url");
    const maxAgeSeconds = admin
      ? readAdminSessionLifetimeSeconds()
      : userSessionLifetimeSeconds;
    const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
    const mfaVerifiedAt = admin ? new Date() : null;
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash: this.hashToken(cookieValue),
        expiresAt,
        mfaVerifiedAt,
      },
      include: {
        user: { select: { id: true, email: true, role: true } },
      },
    });

    return {
      id: session.id,
      cookieValue,
      expiresAt,
      maxAgeSeconds,
      mfaVerifiedAt: session.mfaVerifiedAt,
      user: session.user,
    };
  }

  async readCookieValue(
    value: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!value || !sessionTokenPattern.test(value)) {
      return null;
    }

    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.hashToken(value) },
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
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      !session.user.emailVerifiedAt ||
      session.user.accountDeletedAt ||
      (session.user.role === "ADMIN" &&
        (!session.mfaVerifiedAt ||
          !session.user.mfaEnabledAt ||
          !session.user.mfaSecretEncrypted))
    ) {
      return null;
    }

    return {
      id: session.id,
      mfaVerifiedAt: session.mfaVerifiedAt,
      user: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
      },
    };
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }

  private signCsrfNonce(nonce: string): Buffer {
    return createHmac("sha256", this.secret)
      .update("lydoc-csrf-v1\0")
      .update(nonce)
      .digest();
  }
}

function readAdminSessionLifetimeSeconds(): number {
  const minutes = Number(process.env.ADMIN_SESSION_TTL_MINUTES);
  const boundedMinutes =
    Number.isInteger(minutes) && minutes >= 5 && minutes <= 60 ? minutes : 30;
  return boundedMinutes * 60;
}
