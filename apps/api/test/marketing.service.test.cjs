const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MarketingService,
} = require("../dist/modules/marketing/marketing.service.js");

test("marketing funnel returns aggregate product stages without personal data", async () => {
  const prisma = {
    user: {
      async count({ where }) {
        if (!where.emailVerifiedAt) return 100;
        if (where.documents) return 45;
        if (where.cases?.some?.selfServiceDownloadedAt) return 20;
        if (where.cases?.some?.status === "REFUNDED") return 8;
        if (where.cases) return 30;
        return 80;
      },
    },
  };

  const result = await new MarketingService(prisma).getFunnelOverview();

  assert.equal(result.windows.length, 3);
  assert.deepEqual(
    result.windows.map((window) => window.label),
    ["7 derniers jours", "28 derniers jours", "Depuis le lancement"],
  );
  assert.deepEqual(result.windows[0], {
    days: 7,
    label: "7 derniers jours",
    registered: 100,
    verified: 80,
    invoiceUploaded: 45,
    caseCreated: 30,
    packetDownloaded: 20,
    refunded: 8,
  });
  assert.equal(JSON.stringify(result).includes("email"), false);
  assert.equal(JSON.stringify(result).includes("userId"), false);
});
