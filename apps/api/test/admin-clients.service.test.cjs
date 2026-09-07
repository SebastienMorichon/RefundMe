const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AdminClientsService,
} = require("../dist/modules/identity/admin-clients.service.js");

test("admin client overview scopes people, sessions and SMS+ case estimates", async () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  const users = [
    {
      id: "client-1",
      email: "verified@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      emailVerifiedAt: new Date("2026-08-01T10:00:00.000Z"),
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
    },
    {
      id: "client-2",
      email: "pending@example.com",
      firstName: null,
      lastName: null,
      emailVerifiedAt: null,
      createdAt: new Date("2026-08-20T09:00:00.000Z"),
    },
  ];

  const prisma = {
    user: {
      async count({ where }) {
        if (where.sessions?.some) return 1;
        if (where.emailVerifiedAt) return 1;
        if (where.accountDeletedAt === null && where.role === "USER") {
          return where.email ? 1 : 2;
        }
        return 2;
      },
      async findMany() {
        return users;
      },
    },
    administrativeCase: {
      async count({ where }) {
        return where.status?.notIn ? 2 : 5;
      },
      async aggregate({ _avg }) {
        return _avg
          ? {
              _count: { _all: 2 },
              _sum: { estimatedRecoverableCents: 5000 },
              _avg: { estimatedRecoverableCents: 2500 },
            }
          : { _sum: { estimatedRecoverableCents: 10000 } };
      },
      async groupBy() {
        return [
          {
            ownerId: "client-1",
            status: "REFUNDED",
            _count: { _all: 2 },
            _sum: { estimatedRecoverableCents: 5000 },
          },
          {
            ownerId: "client-2",
            status: "DRAFT",
            _count: { _all: 1 },
            _sum: { estimatedRecoverableCents: 5000 },
          },
        ];
      },
    },
    userSession: {
      async groupBy({ where }) {
        if (where.lastSeenAt) {
          return [{ userId: "client-1", _count: { _all: 1 } }];
        }
        return [
          {
            userId: "client-1",
            _max: {
              lastSeenAt: new Date("2026-09-07T11:59:00.000Z"),
              createdAt: new Date("2026-08-01T10:00:00.000Z"),
            },
          },
        ];
      },
    },
  };

  const result = await new AdminClientsService(prisma).getOverview(
    { page: 1, limit: 25, search: "", filter: "all" },
    now,
  );

  assert.deepEqual(result.stats, {
    registeredClients: 2,
    verifiedClients: 1,
    onlineClients: 1,
    totalCases: 5,
    activeCases: 2,
    refundedCases: 2,
    estimatedRecoverableCents: 10000,
    estimatedRefundedCents: 5000,
    averageEstimatedRefundedCents: 2500,
  });
  assert.equal(result.pagination.total, 2);
  assert.equal(result.clients[0].isOnline, true);
  assert.equal(result.clients[0].refundedCaseCount, 2);
  assert.equal(result.clients[0].estimatedRefundedCents, 5000);
  assert.equal(result.clients[0].averageEstimatedRefundedCents, 2500);
  assert.equal(result.clients[1].isOnline, false);
  assert.equal(result.clients[1].averageEstimatedRefundedCents, null);
  assert.deepEqual(Object.keys(result.clients[0]).sort(), [
    "activeCaseCount",
    "activeSessionCount",
    "averageEstimatedRefundedCents",
    "caseCount",
    "createdAt",
    "email",
    "emailVerifiedAt",
    "estimatedRecoverableCents",
    "estimatedRefundedCents",
    "firstName",
    "id",
    "isOnline",
    "lastActivityAt",
    "lastName",
    "refundedCaseCount",
  ]);
});
