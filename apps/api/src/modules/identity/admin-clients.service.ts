import { Injectable } from "@nestjs/common";
import { CaseStatus, Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const adminClientOnlineWindowMinutes = 5;

export type AdminClientFilter =
  "all" | "online" | "offline" | "unverified" | "with_cases" | "refunded";

export type AdminClientsQuery = Readonly<{
  page: number;
  limit: number;
  search: string;
  filter: AdminClientFilter;
}>;

@Injectable()
export class AdminClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(input: AdminClientsQuery, now = new Date()) {
    const onlineSince = new Date(
      now.getTime() - adminClientOnlineWindowMinutes * 60_000,
    );
    const customerWhere: Prisma.UserWhereInput = {
      role: UserRole.USER,
      accountDeletedAt: null,
    };
    const onlineSessionWhere: Prisma.UserSessionWhereInput = {
      revokedAt: null,
      expiresAt: { gt: now },
      lastSeenAt: { gte: onlineSince },
      user: {
        role: UserRole.USER,
        accountDeletedAt: null,
        emailVerifiedAt: { not: null },
      },
    };
    const listWhere: Prisma.UserWhereInput = {
      ...customerWhere,
      ...(input.search
        ? {
            OR: [
              { email: { contains: input.search, mode: "insensitive" } },
              { firstName: { contains: input.search, mode: "insensitive" } },
              { lastName: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...clientFilterWhere(input.filter, onlineSessionWhere),
    };
    const historicalCaseOwnerWhere: Prisma.UserWhereInput = {
      role: UserRole.USER,
    };
    const eligibleCaseWhere: Prisma.AdministrativeCaseWhereInput = {
      owner: historicalCaseOwnerWhere,
      status: { notIn: [CaseStatus.REJECTED, CaseStatus.CANCELLED] },
    };

    const [
      registeredClients,
      verifiedClients,
      onlineClients,
      totalCases,
      activeCases,
      estimatedAmounts,
      refunds,
      filteredClients,
      clients,
    ] = await Promise.all([
      this.prisma.user.count({ where: customerWhere }),
      this.prisma.user.count({
        where: { ...customerWhere, emailVerifiedAt: { not: null } },
      }),
      this.prisma.user.count({
        where: { ...customerWhere, sessions: { some: onlineSessionWhere } },
      }),
      this.prisma.administrativeCase.count({
        where: { owner: historicalCaseOwnerWhere },
      }),
      this.prisma.administrativeCase.count({
        where: {
          owner: historicalCaseOwnerWhere,
          status: {
            notIn: [
              CaseStatus.REFUNDED,
              CaseStatus.REJECTED,
              CaseStatus.CANCELLED,
            ],
          },
        },
      }),
      this.prisma.administrativeCase.aggregate({
        where: eligibleCaseWhere,
        _sum: { estimatedRecoverableCents: true },
      }),
      this.prisma.administrativeCase.aggregate({
        where: {
          owner: historicalCaseOwnerWhere,
          status: CaseStatus.REFUNDED,
        },
        _count: { _all: true },
        _sum: { estimatedRecoverableCents: true },
        _avg: { estimatedRecoverableCents: true },
      }),
      this.prisma.user.count({ where: listWhere }),
      this.prisma.user.findMany({
        where: listWhere,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          emailVerifiedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
    ]);

    const clientIds = clients.map((client) => client.id);
    const [caseGroups, activeSessionGroups, sessionActivityGroups] =
      clientIds.length > 0
        ? await Promise.all([
            this.prisma.administrativeCase.groupBy({
              by: ["ownerId", "status"],
              where: { ownerId: { in: clientIds } },
              _count: { _all: true },
              _sum: { estimatedRecoverableCents: true },
            }),
            this.prisma.userSession.groupBy({
              by: ["userId"],
              where: { userId: { in: clientIds }, ...onlineSessionWhere },
              _count: { _all: true },
            }),
            this.prisma.userSession.groupBy({
              by: ["userId"],
              where: { userId: { in: clientIds } },
              _max: { lastSeenAt: true, createdAt: true },
            }),
          ])
        : [[], [], []];

    const casesByClient = groupCases(caseGroups);
    const activeSessionsByClient = new Map(
      activeSessionGroups.map((group) => [group.userId, group._count._all]),
    );
    const activityByClient = new Map(
      sessionActivityGroups.map((group) => [
        group.userId,
        group._max.lastSeenAt ?? group._max.createdAt,
      ]),
    );

    return {
      generatedAt: now,
      onlineWindowMinutes: adminClientOnlineWindowMinutes,
      stats: {
        registeredClients,
        verifiedClients,
        onlineClients,
        totalCases,
        activeCases,
        refundedCases: refunds._count._all,
        estimatedRecoverableCents:
          estimatedAmounts._sum.estimatedRecoverableCents ?? 0,
        estimatedRefundedCents: refunds._sum.estimatedRecoverableCents ?? 0,
        averageEstimatedRefundedCents:
          refunds._avg.estimatedRecoverableCents === null
            ? null
            : Math.round(refunds._avg.estimatedRecoverableCents),
      },
      clients: clients.map((client) =>
        presentClient(
          client,
          casesByClient.get(client.id) ?? emptyClientCaseStats(),
          activeSessionsByClient.get(client.id) ?? 0,
          activityByClient.get(client.id) ?? null,
        ),
      ),
      pagination: {
        page: input.page,
        limit: input.limit,
        total: filteredClients,
        totalPages: Math.max(1, Math.ceil(filteredClients / input.limit)),
      },
    };
  }
}

type ClientRecord = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    firstName: true;
    lastName: true;
    emailVerifiedAt: true;
    createdAt: true;
  };
}>;

type ClientCaseStats = {
  caseCount: number;
  activeCaseCount: number;
  refundedCaseCount: number;
  estimatedRecoverableCents: number;
  estimatedRefundedCents: number;
};

type CaseGroup = Readonly<{
  ownerId: string;
  status: CaseStatus;
  _count: { _all: number };
  _sum: { estimatedRecoverableCents: number | null };
}>;

function presentClient(
  client: ClientRecord,
  cases: ClientCaseStats,
  activeSessionCount: number,
  lastActivityAt: Date | null,
) {
  return {
    id: client.id,
    email: client.email,
    firstName: client.firstName,
    lastName: client.lastName,
    emailVerifiedAt: client.emailVerifiedAt,
    createdAt: client.createdAt,
    isOnline: activeSessionCount > 0,
    activeSessionCount,
    lastActivityAt,
    caseCount: cases.caseCount,
    activeCaseCount: cases.activeCaseCount,
    refundedCaseCount: cases.refundedCaseCount,
    estimatedRecoverableCents: cases.estimatedRecoverableCents,
    estimatedRefundedCents: cases.estimatedRefundedCents,
    averageEstimatedRefundedCents:
      cases.refundedCaseCount > 0
        ? Math.round(cases.estimatedRefundedCents / cases.refundedCaseCount)
        : null,
  };
}

function groupCases(groups: ReadonlyArray<CaseGroup>) {
  const result = new Map<string, ClientCaseStats>();
  for (const group of groups) {
    const current = result.get(group.ownerId) ?? emptyClientCaseStats();
    const count = group._count._all;
    const amount = group._sum.estimatedRecoverableCents ?? 0;
    current.caseCount += count;
    if (
      group.status !== CaseStatus.REFUNDED &&
      group.status !== CaseStatus.REJECTED &&
      group.status !== CaseStatus.CANCELLED
    ) {
      current.activeCaseCount += count;
    }
    if (
      group.status !== CaseStatus.REJECTED &&
      group.status !== CaseStatus.CANCELLED
    ) {
      current.estimatedRecoverableCents += amount;
    }
    if (group.status === CaseStatus.REFUNDED) {
      current.refundedCaseCount += count;
      current.estimatedRefundedCents += amount;
    }
    result.set(group.ownerId, current);
  }
  return result;
}

function emptyClientCaseStats(): ClientCaseStats {
  return {
    caseCount: 0,
    activeCaseCount: 0,
    refundedCaseCount: 0,
    estimatedRecoverableCents: 0,
    estimatedRefundedCents: 0,
  };
}

function clientFilterWhere(
  filter: AdminClientFilter,
  onlineSessionWhere: Prisma.UserSessionWhereInput,
): Prisma.UserWhereInput {
  if (filter === "online") {
    return { sessions: { some: onlineSessionWhere } };
  }
  if (filter === "offline") {
    return { sessions: { none: onlineSessionWhere } };
  }
  if (filter === "unverified") {
    return { emailVerifiedAt: null };
  }
  if (filter === "with_cases") {
    return { cases: { some: {} } };
  }
  if (filter === "refunded") {
    return { cases: { some: { status: CaseStatus.REFUNDED } } };
  }
  return {};
}
