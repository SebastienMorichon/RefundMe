const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const {
  calculatePostalExpenseClaimCosts,
  canGeneratePacket,
  createCasePacket,
  findMissingRequiredDocumentLabels,
  generatedPacketEncryptionContext,
  postalExpenseClaimParagraphs,
  sensitivePacketRetentionDeadline,
  smsParticipationParagraph,
  shouldGenerateFinalPacket,
} = require("../dist/modules/packets/packets.service.js");

test("only complete or paid cases can generate a packet", () => {
  assert.equal(canGeneratePacket("DRAFT"), false);
  assert.equal(canGeneratePacket("WAITING_FOR_USER_DOCUMENTS"), false);
  assert.equal(canGeneratePacket("READY_TO_PAY"), true);
  assert.equal(canGeneratePacket("PAID"), true);
});

test("anchors sensitive retention and packet encryption to the first generation", () => {
  const generatedAt = new Date("2026-08-03T12:00:00.000Z");
  assert.equal(
    sensitivePacketRetentionDeadline(generatedAt, 30).toISOString(),
    "2026-09-02T12:00:00.000Z",
  );
  assert.deepEqual(generatedPacketEncryptionContext("user-1", "case-1"), {
    ownerId: "user-1",
    caseId: "case-1",
    purpose: "GENERATED_PACKET",
  });
});

test("generates the complete packet for the free self-service option", () => {
  assert.equal(
    shouldGenerateFinalPacket(false, "SELF_SERVICE", undefined),
    true,
  );
  assert.equal(
    shouldGenerateFinalPacket(false, "MANAGED_POSTAL", undefined),
    false,
  );
  assert.equal(
    shouldGenerateFinalPacket(false, "MANAGED_POSTAL", "PAID"),
    true,
  );
  assert.equal(shouldGenerateFinalPacket(true, null, undefined), true);
});

test("detects required documents missing from a case", () => {
  const required = [
    { kind: "ORANGE_INVOICE", label: "Facture operateur", required: true },
    { kind: "BANK_DETAILS", label: "RIB", required: true },
    { kind: "IDENTITY_DOCUMENT", label: "Piece d'identite", required: false },
  ];

  assert.deepEqual(
    findMissingRequiredDocumentLabels(required, ["ORANGE_INVOICE"]),
    ["RIB"],
  );
});

test("accepts the analyzed operator invoice as the required purchase proof", () => {
  const required = [
    {
      kind: "PURCHASE_PROOF",
      label:
        "facture détaillée complète de l'opérateur mobile avec les numéros SMS facturés",
      required: true,
    },
    {
      kind: "IDENTITY_DOCUMENT",
      label: "copie de la pièce d'identité du titulaire",
      required: true,
    },
    {
      kind: "BANK_DETAILS",
      label: "RIB du titulaire de la ligne",
      required: true,
    },
  ];

  assert.deepEqual(
    findMissingRequiredDocumentLabels(required, [
      "ORANGE_INVOICE",
      "IDENTITY_DOCUMENT",
      "BANK_DETAILS",
    ]),
    [],
  );
  assert.deepEqual(
    findMissingRequiredDocumentLabels(required, [
      "IDENTITY_DOCUMENT",
      "BANK_DETAILS",
    ]),
    ["Facture opérateur"],
  );
});

test("adds the optional postage and printing request to the letter", () => {
  const paragraphs = postalExpenseClaimParagraphs({
    requested: true,
    selectedAt: "2026-07-14T10:00:00.000Z",
    terms: {
      available: true,
      appliesTo: "REFUND_REQUEST",
      postage: {
        reimbursable: true,
        amountCents: null,
        basis: "tarif lettre verte moins de 20 g",
      },
      printing: {
        reimbursable: true,
        centsPerPage: 15,
        maxPages: 10,
        basis: "",
      },
      claimLimit: {
        scope: "PER_HOUSEHOLD_PER_GAME",
        strict: true,
        details: "une seule demande par foyer et par jeu",
      },
      requestInstructions: "Demande expresse formulee dans le meme courrier.",
      requiredProofs: [],
      sourceReference: "Article 6",
    },
  });

  assert.equal(paragraphs.length, 3);
  assert.match(paragraphs[0], /frais d'affranchissement et d'impression/);
  assert.match(paragraphs[0], /l'article 6 du règlement/);
  assert.match(paragraphs[1], /0,15 euro par page/);
  assert.match(paragraphs[2], /seule présentée par mon foyer/);
  assert.doesNotMatch(paragraphs.join(" "), /\(s\)/);
});

test("calculates postal expense reimbursement from rule terms and packet pages", () => {
  const costs = calculatePostalExpenseClaimCosts(
    {
      requested: true,
      selectedAt: "2026-07-14T10:00:00.000Z",
      terms: {
        available: true,
        appliesTo: "REFUND_REQUEST",
        postage: {
          reimbursable: true,
          amountCents: null,
          basis: "timbre au tarif en vigueur",
        },
        printing: {
          reimbursable: true,
          centsPerPage: 30,
          maxPages: null,
          basis: "0,30 EUR par page",
        },
        claimLimit: {
          scope: "PER_HOUSEHOLD_PER_GAME",
          strict: false,
          details: "",
        },
        requestInstructions: "",
        requiredProofs: [],
        sourceReference: "Article 6",
      },
    },
    4,
    152,
  );

  assert.deepEqual(costs, {
    postageCents: 152,
    printingCents: 120,
    printingCentsPerPage: 30,
    printingPageCount: 4,
    totalCents: 272,
  });
});

test("uses natural singular and plural wording for detected SMS", () => {
  assert.equal(
    smsParticipationParagraph([
      { label: "SMS+ jeu", code: "74600", quantity: 1, amountCents: 99 },
    ]),
    "La facture détaillée de mon opérateur, jointe à ce courrier, fait apparaître un SMS envoyé au numéro court 74600 pour participer à ce jeu.",
  );

  const plural = smsParticipationParagraph([
    { label: "SMS+ jeu", code: "74600", quantity: 3, amountCents: 297 },
  ]);
  assert.match(plural, /3 SMS envoyés au numéro court 74600/);
  assert.doesNotMatch(plural, /\(s\)/);
});

test("generates a neutral one-page reimbursement letter preview", async () => {
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
      reimbursementAddress:
        "111 quai du President Roosevelt, 92130 Issy-les-Moulineaux",
      reimbursementDeadline: "30 jours apres la participation",
      reimbursementMethod: "virement bancaire",
      requiredLetterMentions: [
        "Reference du jeu et numero de telephone participant",
      ],
    },
    smsCharges: [
      { label: "SMS+ jeu", code: "12345", quantity: 3, amountCents: 1485 },
    ],
    createdAt: new Date("2026-07-14T10:00:00Z"),
    paidAt: null,
    preview: true,
  });

  assert.ok(bytes.length > 1_000);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(
    pdf.getTitle(),
    "Demande de remboursement - Offre de remboursement test",
  );
  assert.equal(pdf.getAuthor(), "client@example.com");
  assert.equal(
    pdf.getSubject(),
    "Demande personnelle de remboursement des frais de participation",
  );
  assert.equal(pdf.getTitle().includes("Lydoc"), false);
  assert.equal(pdf.getAuthor().includes("Lydoc"), false);
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
    smsCharges: [
      { label: "SMS+ jeu", code: "61234", quantity: 6, amountCents: 1794 },
    ],
    attachments: [
      {
        name: "facture-orange.pdf",
        kind: "ORANGE_INVOICE",
        mimeType: "application/pdf",
        bytes: await invoice.save(),
      },
      {
        name: "rib.pdf",
        kind: "BANK_DETAILS",
        mimeType: "application/pdf",
        bytes: await bankDetails.save(),
      },
    ],
    createdAt: new Date("2026-07-14T10:00:00Z"),
    paidAt: new Date("2026-07-14T10:05:00Z"),
    preview: false,
  });

  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 3);
  assert.equal(
    pdf.getTitle(),
    "Demande de remboursement - Frais SMS+ detectes",
  );
  assert.equal(pdf.getAuthor(), "client@example.com");
});
