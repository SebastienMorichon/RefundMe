import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { readAuthenticationSecret } from "./authentication-secret";

export type AuthBudgetAction =
  "REGISTER" | "RESEND" | "FORGOT_PASSWORD" | "MFA_CHALLENGE";

export class AuthBudgetExceededError extends HttpException {
  constructor() {
    super(
      "Capacite temporairement atteinte. Reessayez plus tard.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class PersistentAuthBudgetService {
  private readonly secret = readAuthenticationSecret();

  constructor(private readonly prisma: PrismaService) {}

  async consume(
    action: AuthBudgetAction,
    identifier: string | null = null,
    now = new Date(),
  ): Promise<void> {
    const hourStart = new Date(now);
    hourStart.setUTCMinutes(0, 0, 0);
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const hourExpiry = new Date(hourStart.getTime() + 3 * 60 * 60 * 1_000);
    const dayExpiry = new Date(dayStart.getTime() + 3 * 24 * 60 * 60 * 1_000);

    await this.prisma.$transaction(async (transaction) => {
      if (action !== "MFA_CHALLENGE") {
        await consumeBucket(transaction, {
          key: `identity:email:day:${dayStart.toISOString().slice(0, 10)}`,
          limit: readLimit("AUTH_EMAIL_DAILY_GLOBAL_LIMIT", 500, 100_000),
          expiresAt: dayExpiry,
        });
      }
      await consumeBucket(transaction, {
        key: `identity:${action.toLowerCase()}:hour:${hourStart.toISOString().slice(0, 13)}`,
        limit: actionLimit(action),
        expiresAt: hourExpiry,
      });
      await consumeBucket(transaction, {
        key: `identity:${action.toLowerCase()}:id:${this.hashIdentifier(identifier)}:${hourStart.toISOString().slice(0, 13)}`,
        limit: identifierLimit(action),
        expiresAt: hourExpiry,
      });
    });
  }

  private hashIdentifier(identifier: string | null): string {
    return createHmac("sha256", this.secret)
      .update("lydoc-auth-budget-identifier-v1\0")
      .update(identifier?.trim().toLowerCase() || "invalid")
      .digest("hex")
      .slice(0, 24);
  }
}

async function consumeBucket(
  transaction: Prisma.TransactionClient,
  input: { key: string; limit: number; expiresAt: Date },
): Promise<void> {
  await transaction.authBudgetBucket.upsert({
    where: { key: input.key },
    create: { key: input.key, count: 0, expiresAt: input.expiresAt },
    update: { expiresAt: input.expiresAt },
  });
  const updated = await transaction.authBudgetBucket.updateMany({
    where: { key: input.key, count: { lt: input.limit } },
    data: { count: { increment: 1 } },
  });
  if (updated.count !== 1) throw new AuthBudgetExceededError();
}

function actionLimit(action: AuthBudgetAction): number {
  if (action === "REGISTER") {
    return readLimit("AUTH_REGISTER_HOURLY_GLOBAL_LIMIT", 100, 10_000);
  }
  if (action === "RESEND") {
    return readLimit("AUTH_RESEND_HOURLY_GLOBAL_LIMIT", 100, 10_000);
  }
  if (action === "FORGOT_PASSWORD") {
    return readLimit("AUTH_FORGOT_HOURLY_GLOBAL_LIMIT", 100, 10_000);
  }
  return readLimit("AUTH_MFA_CHALLENGE_HOURLY_GLOBAL_LIMIT", 200, 10_000);
}

function identifierLimit(action: AuthBudgetAction): number {
  if (action === "REGISTER") {
    return readLimit("AUTH_REGISTER_HOURLY_IDENTIFIER_LIMIT", 10, 1_000);
  }
  if (action === "RESEND") {
    return readLimit("AUTH_RESEND_HOURLY_IDENTIFIER_LIMIT", 5, 1_000);
  }
  if (action === "FORGOT_PASSWORD") {
    return readLimit("AUTH_FORGOT_HOURLY_IDENTIFIER_LIMIT", 5, 1_000);
  }
  return readLimit("AUTH_MFA_CHALLENGE_HOURLY_IDENTIFIER_LIMIT", 5, 1_000);
}

function readLimit(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 && value <= maximum
    ? value
    : fallback;
}
