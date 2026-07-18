const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const { createPostalProvider } = require("../dist/modules/shipping/postal-provider.js");
const { ruleRecipientPostalAddress } = require("../dist/modules/shipping/postal-address.js");

test("extracts the postal recipient from the frozen rule", () => {
  const address = ruleRecipientPostalAddress({
    organizerName: "Orange",
    constraints: {
      reimbursementRecipient: "Service remboursements",
      reimbursementAddress: "12 rue des Jeux, Batiment B, 75008 Paris",
    },
  });
  assert.deepEqual(address, {
    company: "Service remboursements",
    addressLine1: "12 rue des Jeux",
    addressLine2: "Batiment B",
    postalCode: "75008",
    city: "Paris",
    country: "France",
  });
});

test("quotes a tracked green letter without external transmission in mock mode", async () => {
  const previousProvider = process.env.POSTAL_PROVIDER;
  process.env.POSTAL_PROVIDER = "mock";
  try {
    const document = await PDFDocument.create();
    document.addPage();
    document.addPage();
    const provider = createPostalProvider();
    const quote = await provider.preview({
      caseId: "case-test",
      product: "vertesuivi",
      sender: { firstName: "Jean", lastName: "Dupont", addressLine1: "1 rue A", postalCode: "75001", city: "Paris", country: "France" },
      recipient: { company: "Jeu", addressLine1: "2 rue B", postalCode: "69001", city: "Lyon", country: "France" },
      pdf: Buffer.from(await document.save()),
    });
    assert.equal(quote.provider, "mock");
    assert.equal(quote.environment, "sandbox");
    assert.equal(quote.postageCents, 202);
    assert.equal(quote.totalCents, 323);
  } finally {
    if (previousProvider === undefined) delete process.env.POSTAL_PROVIDER;
    else process.env.POSTAL_PROVIDER = previousProvider;
  }
});
