import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { IdentityTokenPurpose, Prisma } from "@prisma/client";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { readAuthenticationSecret } from "./authentication-secret";
import {
  IdentityEmailDeliveryError,
  IdentityEmailService,
} from "./identity-email.service";

const rawTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const envelopeVersion = "v1";

type ClaimedIdentityEmail = Readonly<{
  id: string;
  userId: string;
  tokenId: string;
  rawTokenEncrypted: string;
  attempts: number;
  lockId: string | null;
  user: {
    email: string;
    accountDeletedAt: Date | null;
  };
  token: {
    purpose: IdentityTokenPurpose;
    expiresAt: Date;
    usedAt: Date | null;
  };
}>;

export type IdentityEmailOutboxRunResult = Readonly<{
  claimed: number;
  sent: number;
  retried: number;
  deadLettered: number;
}>;

@Injectable()
export class IdentityEmailOutboxService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly encryptionSecret = readOutboxEncryptionSecret();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: IdentityEmailService,
  ) {}

  onModuleInit(): void {
    void this.runOnce().catch(() => undefined);
    this.timer = setInterval(
      () => void this.runOnce().catch(() => undefined),
      readBoundedInteger(
        "IDENTITY_EMAIL_OUTBOX_INTERVAL_MS",
        1_000,
        250,
        60_000,
      ),
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async enqueue(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      tokenId: string;
      rawToken: string;
    },
  ): Promise<void> {
    if (!rawTokenPattern.test(input.rawToken)) {
      throw new Error("Invalid identity token for e-mail outbox.");
    }
    await transaction.identityEmailOutbox.create({
      data: {
        userId: input.userId,
        tokenId: input.tokenId,
        rawTokenEncrypted: encryptOutboxToken(
          input.rawToken,
          input.userId,
          input.tokenId,
          this.encryptionSecret,
        ),
      },
    });
  }

  kick(): void {
    queueMicrotask(() => void this.runOnce().catch(() => undefined));
  }

  async runOnce(now = new Date()): Promise<IdentityEmailOutboxRunResult> {
    if (this.running) {
      return { claimed: 0, sent: 0, retried: 0, deadLettered: 0 };
    }
    this.running = true;
    try {
      const claimed = await this.claimBatch(now);
      const outcomes: Array<"SENT" | "RETRIED" | "DEAD_LETTERED"> = [];
      const concurrency = readBoundedInteger(
        "IDENTITY_EMAIL_OUTBOX_CONCURRENCY",
        2,
        1,
        5,
      );
      for (let index = 0; index < claimed.length; index += concurrency) {
        outcomes.push(
          ...(await Promise.all(
            claimed
              .slice(index, index + concurrency)
              .map((item) => this.deliverClaim(item, now)),
          )),
        );
      }
      return {
        claimed: claimed.length,
        sent: outcomes.filter((outcome) => outcome === "SENT").length,
        retried: outcomes.filter((outcome) => outcome === "RETRIED").length,
        deadLettered: outcomes.filter((outcome) => outcome === "DEAD_LETTERED")
          .length,
      };
    } finally {
      this.running = false;
    }
  }

  private async claimBatch(now: Date): Promise<ClaimedIdentityEmail[]> {
    const lockId = randomUUID();
    const leaseCutoff = new Date(
      now.getTime() -
        readBoundedInteger(
          "IDENTITY_EMAIL_OUTBOX_LEASE_SECONDS",
          120,
          30,
          600,
        ) *
          1_000,
    );
    const batchSize = readBoundedInteger(
      "IDENTITY_EMAIL_OUTBOX_BATCH_SIZE",
      10,
      1,
      50,
    );
    const maximumAttempts = readMaximumAttempts();

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        SELECT "id"
        FROM "IdentityEmailOutbox"
        WHERE "sentAt" IS NULL
          AND "deadLetteredAt" IS NULL
          AND "availableAt" <= ${now}
          AND "attempts" < ${maximumAttempts}
          AND ("lockedAt" IS NULL OR "lockedAt" < ${leaseCutoff})
        ORDER BY "availableAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      `);
      if (rows.length === 0) return [];
      const ids = rows.map(({ id }) => id);
      await transaction.identityEmailOutbox.updateMany({
        where: { id: { in: ids }, sentAt: null, deadLetteredAt: null },
        data: { lockedAt: now, lockId },
      });
      return transaction.identityEmailOutbox.findMany({
        where: { id: { in: ids }, lockId },
        include: {
          user: { select: { email: true, accountDeletedAt: true } },
          token: {
            select: { purpose: true, expiresAt: true, usedAt: true },
          },
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      }) as Promise<ClaimedIdentityEmail[]>;
    });
  }

  private async deliverClaim(
    claim: ClaimedIdentityEmail,
    now: Date,
  ): Promise<"SENT" | "RETRIED" | "DEAD_LETTERED"> {
    if (
      !claim.lockId ||
      claim.user.accountDeletedAt ||
      claim.token.usedAt ||
      claim.token.expiresAt.getTime() <= now.getTime() ||
      claim.token.purpose === IdentityTokenPurpose.ADMIN_MFA_LOGIN
    ) {
      await this.recordFailure(claim, now, "TOKEN_NOT_DELIVERABLE", false);
      return "DEAD_LETTERED";
    }

    let rawToken: string;
    try {
      rawToken = decryptOutboxToken(
        claim.rawTokenEncrypted,
        claim.userId,
        claim.tokenId,
        this.encryptionSecret,
      );
    } catch {
      await this.recordFailure(claim, now, "TOKEN_DECRYPTION_FAILED", false);
      return "DEAD_LETTERED";
    }

    try {
      const providerMessageId = await this.emails.send({
        email: claim.user.email,
        purpose: claim.token.purpose,
        rawToken,
        tokenId: claim.tokenId,
        expiresAt: claim.token.expiresAt,
      });
      await this.recordSuccess(claim, now, providerMessageId);
      return "SENT";
    } catch (error) {
      const failure = classifyDeliveryFailure(error);
      const deadLettered = await this.recordFailure(
        claim,
        now,
        failure.code,
        failure.retryable,
      );
      return deadLettered ? "DEAD_LETTERED" : "RETRIED";
    }
  }

  private async recordSuccess(
    claim: ClaimedIdentityEmail,
    now: Date,
    providerMessageId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.identityEmailOutbox.updateMany({
        where: {
          id: claim.id,
          lockId: claim.lockId,
          sentAt: null,
          deadLetteredAt: null,
        },
        data: {
          sentAt: now,
          providerMessageId,
          failureCode: null,
          lockedAt: null,
          lockId: null,
        },
      });
      if (updated.count !== 1) return;
      await transaction.auditLog.create({
        data: {
          actorId: claim.userId,
          action: providerMessageId
            ? "IDENTITY_EMAIL_SENT"
            : "IDENTITY_EMAIL_SKIPPED_NON_PRODUCTION",
          entityType: "User",
          entityId: claim.userId,
          metadata: {
            purpose: claim.token.purpose,
            tokenId: claim.tokenId,
            provider: providerMessageId ? "resend" : null,
            providerMessageId,
          },
        },
      });
    });
  }

  private async recordFailure(
    claim: ClaimedIdentityEmail,
    now: Date,
    failureCode: string,
    retryable: boolean,
  ): Promise<boolean> {
    const nextAttempt = claim.attempts + 1;
    const deadLettered = !retryable || nextAttempt >= readMaximumAttempts();
    const availableAt = new Date(
      now.getTime() + identityOutboxRetryDelayMs(nextAttempt),
    );
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.identityEmailOutbox.updateMany({
        where: {
          id: claim.id,
          lockId: claim.lockId,
          sentAt: null,
          deadLetteredAt: null,
        },
        data: {
          attempts: { increment: 1 },
          failureCode: failureCode.slice(0, 48),
          ...(deadLettered ? { deadLetteredAt: now } : { availableAt }),
          lockedAt: null,
          lockId: null,
        },
      });
      if (deadLettered && updated.count === 1) {
        await transaction.auditLog.create({
          data: {
            actorId: claim.userId,
            action: "IDENTITY_EMAIL_DEAD_LETTERED",
            entityType: "User",
            entityId: claim.userId,
            metadata: {
              purpose: claim.token.purpose,
              tokenId: claim.tokenId,
              attempts: nextAttempt,
              failureCode: failureCode.slice(0, 48),
            },
          },
        });
      }
    });
    return deadLettered;
  }
}

export function identityOutboxRetryDelayMs(attempt: number): number {
  const boundedAttempt = Math.max(1, Math.min(20, Math.trunc(attempt)));
  const base = Math.min(
    6 * 60 * 60 * 1_000,
    30_000 * 2 ** (boundedAttempt - 1),
  );
  return base + randomInt(0, Math.max(1, Math.floor(base / 5)));
}

export function encryptOutboxToken(
  rawToken: string,
  userId: string,
  tokenId: string,
  secret: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveOutboxKey(secret), iv);
  cipher.setAAD(outboxAad(userId, tokenId));
  const ciphertext = Buffer.concat([
    cipher.update(rawToken, "utf8"),
    cipher.final(),
  ]);
  return [
    envelopeVersion,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptOutboxToken(
  envelope: string,
  userId: string,
  tokenId: string,
  secret: string,
): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== envelopeVersion) {
    throw new Error("Invalid identity e-mail outbox envelope.");
  }
  const [, encodedIv, encodedTag, encodedCiphertext] = parts;
  const iv = decodeCanonicalBase64Url(encodedIv!, 12);
  const tag = decodeCanonicalBase64Url(encodedTag!, 16);
  const ciphertext = decodeCanonicalBase64Url(encodedCiphertext!, 43);
  const decipher = createDecipheriv("aes-256-gcm", deriveOutboxKey(secret), iv);
  decipher.setAAD(outboxAad(userId, tokenId));
  decipher.setAuthTag(tag);
  const rawToken = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  if (!rawTokenPattern.test(rawToken)) {
    throw new Error("Invalid decrypted identity token.");
  }
  return rawToken;
}

function readOutboxEncryptionSecret(): string {
  const configured = process.env.IDENTITY_OUTBOX_ENCRYPTION_SECRET ?? "";
  if (
    process.env.NODE_ENV !== "production" &&
    (!configured || /change[_-]?me|replace-with/i.test(configured))
  ) {
    return readAuthenticationSecret();
  }
  if (
    configured.length < 32 ||
    /change[_-]?me|replace-with/i.test(configured) ||
    [
      process.env.SESSION_SECRET,
      process.env.MFA_ENCRYPTION_SECRET,
      process.env.DOCUMENT_ENCRYPTION_SECRET,
      process.env.BACKUP_ENCRYPTION_SECRET,
    ].some((secret) => secret && secret === configured)
  ) {
    throw new Error(
      "IDENTITY_OUTBOX_ENCRYPTION_SECRET must be a dedicated secret of at least 32 characters.",
    );
  }
  return configured;
}

function deriveOutboxKey(secret: string): Buffer {
  return createHash("sha256")
    .update("lydoc-identity-email-outbox-encryption-v1\0")
    .update(secret)
    .digest();
}

function outboxAad(userId: string, tokenId: string): Buffer {
  return Buffer.from(
    `lydoc-identity-email-outbox:${envelopeVersion}:${userId}:${tokenId}`,
    "utf8",
  );
}

function decodeCanonicalBase64Url(
  value: string,
  expectedLength: number,
): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid identity e-mail outbox envelope encoding.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== expectedLength ||
    decoded.toString("base64url") !== value
  ) {
    throw new Error("Invalid identity e-mail outbox envelope encoding.");
  }
  return decoded;
}

function classifyDeliveryFailure(error: unknown): {
  code: string;
  retryable: boolean;
} {
  if (error instanceof IdentityEmailDeliveryError) {
    return { code: error.failureCode, retryable: error.retryable };
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return { code: "PROVIDER_TIMEOUT", retryable: true };
  }
  return { code: "PROVIDER_UNAVAILABLE", retryable: true };
}

function readMaximumAttempts(): number {
  return readBoundedInteger("IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS", 6, 1, 20);
}

function readBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}
