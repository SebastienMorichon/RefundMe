import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const consumedRecordRetentionMs = 24 * 60 * 60 * 1_000;

@Injectable()
export class IdentityCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.runCleanup().catch(() => undefined);
    this.timer = setInterval(
      () => void this.runCleanup().catch(() => undefined),
      readBoundedInteger("AUTH_CLEANUP_INTERVAL_MINUTES", 60, 5, 1_440) *
        60 *
        1_000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runCleanup(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const historicalCutoff = new Date(
        now.getTime() - consumedRecordRetentionMs,
      );
      const pendingUserCutoff = new Date(
        now.getTime() -
          readBoundedInteger("AUTH_PENDING_USER_TTL_HOURS", 48, 1, 720) *
            60 *
            60 *
            1_000,
      );
      await this.prisma.$transaction(async (transaction) => {
        const tokens = await transaction.identityToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { usedAt: { lt: historicalCutoff } },
            ],
          },
        });
        const sessions = await transaction.userSession.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { revokedAt: { lt: historicalCutoff } },
            ],
          },
        });
        const budgets = await transaction.authBudgetBucket.deleteMany({
          where: { expiresAt: { lt: now } },
        });
        const users = await transaction.user.deleteMany({
          where: {
            role: "USER",
            accountDeletedAt: null,
            emailVerifiedAt: null,
            createdAt: { lt: pendingUserCutoff },
            cases: { none: {} },
            documents: { none: {} },
            uploadReservations: { none: {} },
          },
        });
        if (tokens.count + sessions.count + budgets.count + users.count > 0) {
          await transaction.auditLog.create({
            data: {
              action: "IDENTITY_TTL_CLEANUP_COMPLETED",
              entityType: "IdentityMaintenance",
              entityId: now.toISOString(),
              metadata: {
                identityTokensDeleted: tokens.count,
                sessionsDeleted: sessions.count,
                budgetBucketsDeleted: budgets.count,
                pendingUsersDeleted: users.count,
              },
            },
          });
        }
      });
    } finally {
      this.running = false;
    }
  }
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
