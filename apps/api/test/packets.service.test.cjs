const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const {
  canGeneratePacket,
  createCasePacket,
  findMissingRequiredDocumentLabels,
  shouldGenerateFinalPacket,
} = require("../dist/modules/packets/packets.service.js");

test("only complete or paid cases can generate a packet", () => {
  assert.equal(canGeneratePacket("DRAFT"), false);
  assert.equal(canGeneratePacket("WAITING_FOR_USER_DOCUMENTS"), false);
  assert.equal(canGeneratePacket("READY_TO_PAY"), true);
  assert.equal(canGeneratePacket("PAID"), true);
});

test("generates the complete packet for the free self-service option", () => {
  assert.equal(shouldGenerateFinalPacket(false, "SELF_SERVICE", undefined), true);
  assert.equal(shouldGenerateFinalPacket(false, "MANAGED_POSTAL", undefined), false);
  assert.equal(shouldGenerateFinalPacket(false, "MANAGED_POSTAL", "PAID"), true);
  assert.equal(shouldGenerateFinalPacket(true, null, undefined), true);
});

test("detects required documents missing from a case", () => {
  const required = [
    { kind: "ORANGE_INVOICE", label: "Facture operateur", required: true },
    { kind: "BANK_DETAILS", label: "RIB", required: true },
    { kind: "IDENTITY_DOCUMENT", label: "Piece d'identite", required: false },
  ];

  assert.deepEqual(findMissingRequiredDocumentLabels(required, ["ORANGE_INVOICE"]), ["RIB"]);
});

test("generates a valid two-page case preview", async () => {
  const bytes = await createCasePacket({
    caseId: "case-test-001",
    customerEmail: "client@example.com",
    organizer: "Orange France",
    gameName: "Offre de remboursement test",
    estimatedRecoverableCents: 1485,
    serviceFeeCents: 299,
    documents: ["facture-orange.pdf", "piece-identite.pdf"],
    requiredDocuments: [
      { kind: "ORANGE_INVOICE", label: "Facture operateur", required: true },
      { kind: "IDENTITY_DOCUMENT", label: "Piece d'identite", required: true },
    ],
    ruleConstraints: {
      reimbursementRecipient: "Service consommateurs Orange",
      reimbursementAddress: "111 quai du President Roosevelt, 92130 Issy-les-Moulineaux",
      reimbursementDeadline: "30 jours apres la participation",
      reimbursementMethod: "virement bancaire",
      requiredLetterMentions: ["Reference du jeu et numero de telephone participant"],
    },
    smsCharges: [{ label: "SMS+ jeu", code: "12345", quantity: 3, amountCents: 1485 }],
    createdAt: new Date("2026-07-14T10:00:00Z"),
    paidAt: null,
    preview: true,
  });

  assert.ok(bytes.length > 1_000);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getTitle(), "Dossier Lydoc case-test-001");
});

test("generates a final packet with attached document pages", async () => {
  const invoice = await PDFDocument.create();
  invoice.addPage([200, 200]);
  const bankDetails = await PDFDocument.create();
  bankDetails.addPage([200, 200]);

  const bytes = await createCasePacket({
    caseId: "case-final-001",
    customerEmail: "client@example.com",
    organizer: "SMS+ Orange",
    gameName: "Frais SMS+ detectes",
    estimatedRecoverableCents: 1794,
    serviceFeeCents: 299,
    documents: ["facture-orange.pdf", "rib.pdf"],
    requiredDocuments: [
      { kind: "ORANGE_INVOICE", label: "Facture operateur", required: true },
      { kind: "BANK_DETAILS", label: "RIB", required: true },
    ],
    ruleConstraints: {
      reimbursementRecipient: "Service remboursement SMS+",
      reimbursementAddress: "10 rue du Jeu, 75001 Paris",
      reimbursementEmail: "remboursement@example.com",
      reimbursementDeadline: "2026-08-14",
      reimbursementMethod: "virement bancaire",
      requiredLetterMentions: [],
    },
    smsCharges: [{ label: "SMS+ jeu", code: "61234", quantity: 6, amountCents: 1794 }],
    attachments: [
      { name: "facture-orange.pdf", kind: "ORANGE_INVOICE", mimeType: "application/pdf", bytes: await invoice.save() },
      { name: "rib.pdf", kind: "BANK_DETAILS", mimeType: "application/pdf", bytes: await bankDetails.save() },
    ],
    createdAt: new Date("2026-07-14T10:00:00Z"),
    paidAt: new Date("2026-07-14T10:05:00Z"),
    preview: false,
  });

  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 6);
  assert.equal(pdf.getTitle(), "Dossier Lydoc case-final-001");
});
