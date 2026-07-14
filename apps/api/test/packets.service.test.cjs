const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const { canGeneratePacket, createCasePacket } = require("../dist/modules/packets/packets.service.js");

test("only complete or paid cases can generate a packet", () => {
  assert.equal(canGeneratePacket("DRAFT"), false);
  assert.equal(canGeneratePacket("WAITING_FOR_USER_DOCUMENTS"), false);
  assert.equal(canGeneratePacket("READY_TO_PAY"), true);
  assert.equal(canGeneratePacket("PAID"), true);
});

test("generates a valid one-page case PDF", async () => {
  const bytes = await createCasePacket({
    caseId: "case-test-001",
    customerEmail: "client@example.com",
    organizer: "Orange France",
    gameName: "Offre de remboursement test",
    estimatedRecoverableCents: 1485,
    serviceFeeCents: 299,
    documents: ["facture-orange.pdf", "piece-identite.pdf"],
    createdAt: new Date("2026-07-14T10:00:00Z"),
    paidAt: null,
    preview: true,
  });

  assert.ok(bytes.length > 1_000);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), "Dossier Lydoc case-test-001");
});
