import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

type FunnelWindow = Readonly<{
  days: number | null;
  label: string;
  registered: number;
  verified: number;
  invoiceUploaded: number;
  caseCreated: number;
  packetDownloaded: number;
  refunded: number;
}>;

@Injectable()
export class MarketingService {
  constructor(private readonly prisma: PrismaService) {}

  async getFunnelOverview() {
    const generatedAt = new Date();
    const [sevenDays, twentyEightDays, allTime] = await Promise.all([
      this.readWindow(7, generatedAt),
      this.readWindow(28, generatedAt),
      this.readWindow(null, generatedAt),
    ]);
    return {
      generatedAt: generatedAt.toISOString(),
      definition:
        "Conversions produit par cohorte de comptes créés dans la période. Aucune donnée personnelle n'est exposée.",
      windows: [sevenDays, twentyEightDays, allTime],
    };
  }

  private async readWindow(
    days: number | null,
    now: Date,
  ): Promise<FunnelWindow> {
    const createdAt = days
      ? { gte: new Date(now.getTime() - days * 24 * 60 * 60 * 1_000) }
      : undefined;
    const cohort = {
      accountDeletedAt: null,
      ...(createdAt ? { createdAt } : {}),
    };

    const [
      registered,
      verified,
      invoiceUploaded,
      caseCreated,
      packetDownloaded,
      refunded,
    ] = await Promise.all([
      this.prisma.user.count({ where: cohort }),
      this.prisma.user.count({
        where: { ...cohort, emailVerifiedAt: { not: null } },
      }),
      this.prisma.user.count({
        where: {
          ...cohort,
          emailVerifiedAt: { not: null },
          documents: { some: { kind: "ORANGE_INVOICE" } },
        },
      }),
      this.prisma.user.count({
        where: {
          ...cohort,
          emailVerifiedAt: { not: null },
          cases: { some: {} },
        },
      }),
      this.prisma.user.count({
        where: {
          ...cohort,
          emailVerifiedAt: { not: null },
          cases: { some: { selfServiceDownloadedAt: { not: null } } },
        },
      }),
      this.prisma.user.count({
        where: {
          ...cohort,
          emailVerifiedAt: { not: null },
          cases: { some: { status: "REFUNDED" } },
        },
      }),
    ]);

    return {
      days,
      label: days ? `${days} derniers jours` : "Depuis le lancement",
      registered,
      verified,
      invoiceUploaded,
      caseCreated,
      packetDownloaded,
      refunded,
    };
  }
}
