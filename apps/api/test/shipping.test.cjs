const assert = require("node:assert/strict");
const test = require("node:test");
const { createHmac } = require("node:crypto");
const { PDFDocument } = require("pdf-lib");
const {
  createPostalProvider,
  isRetryablePostalStatus,
  postalRequestIdempotencyKey,
} = require("../dist/modules/shipping/postal-provider.js");
const {
  authenticatePostalWebhook,
  monotonicPostalStatus,
  verifyPostalWebhookHmac,
} = require("../dist/modules/shipping/shipping.service.js");
const {
  ruleRecipientPostalAddress,
} = require("../dist/modules/shipping/postal-address.js");
const {
  calculateCustomerPostalPricing,
  DEFAULT_PRICING,
} = require("../dist/modules/pricing/pricing.service.js");

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

test("extracts a Libre Reponse address without confusing its routing number with the postal code", () => {
  const address = ruleRecipientPostalAddress({
    organizerName: "M6 DISTRIBUTION DIGITAL",
    constraints: {
      reimbursementRecipient:
        "Service Client - Remboursement M6 / Jeu-Concours FIFA 2026",
      reimbursementAddress: [
        "Service Client - Remboursement M6 / Jeu-Concours FIFA 2026",
        "Libre Reponse 94119",
        "13629 Aix en Provence cedex 1 France",
      ].join("\n"),
    },
  });

  assert.deepEqual(address, {
    company: "Service Client - Remboursement M6 / Jeu-Concours FIFA 2026",
    addressLine1: "Libre Reponse 94119",
    postalCode: "13629",
    city: "Aix en Provence cedex 1",
    country: "France",
  });
});

test("extracts a Libre Reponse address supplied on a single line", () => {
  const address = ruleRecipientPostalAddress({
    organizerName: "M6",
    constraints: {
      reimbursementRecipient: "Service remboursements M6",
      reimbursementAddress:
        "Service remboursements M6 Libre Reponse 94119 13629 Aix en Provence cedex 1 France",
    },
  });

  assert.deepEqual(address, {
    company: "Service remboursements M6",
    addressLine1: "Libre Reponse 94119",
    postalCode: "13629",
    city: "Aix en Provence cedex 1",
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
      sender: {
        firstName: "Jean",
        lastName: "Dupont",
        addressLine1: "1 rue A",
        postalCode: "75001",
        city: "Paris",
        country: "France",
      },
      recipient: {
        company: "Jeu",
        addressLine1: "2 rue B",
        postalCode: "69001",
        city: "Lyon",
        country: "France",
      },
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

test("calculates the configurable customer price independently from provider costs", () => {
  assert.deepEqual(
    calculateCustomerPostalPricing(DEFAULT_PRICING, 7, "vertesuivi"),
    {
      product: "vertesuivi",
      pageCount: 7,
      baseServiceFeeCents: 99,
      serviceFeeCents: 99,
      discountCents: 0,
      discountLabel: null,
      promoCode: null,
      printingCents: 210,
      postageCents: 202,
      postalTotalCents: 412,
      grandTotalCents: 511,
    },
  );
});

test("uses the documented Service Postal preview payload and reads tracking proof", async () => {
  const previous = {
    provider: process.env.POSTAL_PROVIDER,
    key: process.env.SERVICE_POSTAL_API_KEY,
    environment: process.env.SERVICE_POSTAL_ENV,
  };
  const previousFetch = global.fetch;
  process.env.POSTAL_PROVIDER = "service_postal";
  process.env.SERVICE_POSTAL_API_KEY = "sandbox-key";
  process.env.SERVICE_POSTAL_ENV = "sandbox";
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    if (String(url).endsWith("/suivi")) {
      return new Response(
        JSON.stringify({
          numero_suivi_laposte: "2C123",
          evenements: [
            {
              code_statut: "courrier_produit",
              message_statut: "Courrier produit",
              date_statut: "01-08-2026 12:00:00",
              preuve_depot_url: "https://files.servicepostal.com/proof.pdf",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        uid: "l-test",
        affranchissement: 2.02,
        service: 0.9,
        total: 2.92,
        fichier_previsualisation: {
          url: "https://files.servicepostal.com/preview.pdf",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const document = await PDFDocument.create();
    document.addPage();
    const provider = createPostalProvider();
    await provider.preview({
      caseId: "case-test",
      product: "vertesuivi",
      sender: {
        firstName: "Jean",
        lastName: "Dupont",
        addressLine1: "1 rue A",
        postalCode: "75001",
        city: "Paris",
        country: "France",
      },
      recipient: {
        company: "Jeu",
        addressLine1: "2 rue B",
        postalCode: "69001",
        city: "Lyon",
        country: "France",
      },
      pdf: Buffer.from(await document.save()),
    });
    const previewBody = JSON.parse(requests[0].init.body);
    assert.equal(
      requests[0].url,
      "https://sandbox-api.servicepostal.com/lettres/previsualiser",
    );
    assert.equal(previewBody.type_affranchissement, "vertesuivi");
    assert.equal(previewBody.fichier.nom, "dossier-case-test.pdf");
    assert.ok(previewBody.fichier.contenu_base64.length > 20);

    const tracking = await provider.tracking("l-test");
    assert.equal(tracking.trackingNumber, "2C123");
    assert.equal(
      tracking.proofOfDepositUrl,
      "https://files.servicepostal.com/proof.pdf",
    );
  } finally {
    global.fetch = previousFetch;
    restoreEnv("POSTAL_PROVIDER", previous.provider);
    restoreEnv("SERVICE_POSTAL_API_KEY", previous.key);
    restoreEnv("SERVICE_POSTAL_ENV", previous.environment);
  }
});

test("authenticates postal webhooks with HMAC, timestamp and freshness", () => {
  const rawBody = Buffer.from('{"uuid":"postal-1","code_statut":"soumis"}');
  const secret = "postal-webhook-secret-at-least-32-characters";
  const timestamp = "1785751200";
  const signature = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest("hex");
  const replayKey = verifyPostalWebhookHmac({
    rawBody,
    signature: `sha256=${signature}`,
    timestamp,
    secret,
    nowMilliseconds: 1_785_751_200_000,
    toleranceSeconds: 300,
  });
  assert.match(replayKey, /^[a-f\d]{64}$/);
  assert.throws(
    () =>
      verifyPostalWebhookHmac({
        rawBody,
        signature,
        timestamp,
        secret,
        nowMilliseconds: 1_785_752_000_000,
        toleranceSeconds: 300,
      }),
    /expire/i,
  );
  assert.throws(
    () =>
      verifyPostalWebhookHmac({
        rawBody: Buffer.from("tampered"),
        signature,
        timestamp,
        secret,
        nowMilliseconds: 1_785_751_200_000,
        toleranceSeconds: 300,
      }),
    /autorise/i,
  );
});

test("keeps legacy query-token webhook authentication disabled by default", () => {
  const previousSecret = process.env.SERVICE_POSTAL_WEBHOOK_SECRET;
  const previousCompatibility =
    process.env.SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN;
  process.env.SERVICE_POSTAL_WEBHOOK_SECRET =
    "postal-webhook-secret-at-least-32-characters";
  delete process.env.SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN;
  try {
    assert.throws(
      () =>
        authenticatePostalWebhook({
          rawBody: Buffer.from("{}"),
          signature: undefined,
          timestamp: undefined,
          legacyToken: process.env.SERVICE_POSTAL_WEBHOOK_SECRET,
        }),
      /autorise/i,
    );
  } finally {
    restoreEnv("SERVICE_POSTAL_WEBHOOK_SECRET", previousSecret);
    restoreEnv(
      "SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN",
      previousCompatibility,
    );
  }
});

test("never regresses postal progress and keeps terminal states terminal", () => {
  assert.equal(monotonicPostalStatus("SUBMITTED", "PRODUCED"), "PRODUCED");
  assert.equal(monotonicPostalStatus("IN_TRANSIT", "SUBMITTED"), "IN_TRANSIT");
  assert.equal(monotonicPostalStatus("DELIVERED", "FAILED"), "DELIVERED");
  assert.equal(monotonicPostalStatus("FAILED", "DELIVERED"), "FAILED");
});

test("retries bounded idempotent postal requests on transient failures", async () => {
  const previous = {
    provider: process.env.POSTAL_PROVIDER,
    key: process.env.SERVICE_POSTAL_API_KEY,
    environment: process.env.SERVICE_POSTAL_ENV,
    attempts: process.env.SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS,
  };
  const previousFetch = global.fetch;
  process.env.POSTAL_PROVIDER = "service_postal";
  process.env.SERVICE_POSTAL_API_KEY = "sandbox-key";
  process.env.SERVICE_POSTAL_ENV = "sandbox";
  process.env.SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS = "2";
  let attempts = 0;
  let idempotencyKey;
  global.fetch = async (_url, init) => {
    attempts += 1;
    idempotencyKey = new Headers(init.headers).get("Idempotency-Key");
    if (attempts === 1) {
      return new Response(JSON.stringify({ message: "temporary" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        uid: "postal-retry",
        affranchissement: 2.02,
        service: 0.9,
        total: 2.92,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await createPostalProvider().preview({
      caseId: "case-retry",
      product: "vertesuivi",
      sender: {
        firstName: "Jean",
        lastName: "Dupont",
        addressLine1: "1 rue A",
        postalCode: "75001",
        city: "Paris",
        country: "France",
      },
      recipient: {
        company: "Jeu",
        addressLine1: "2 rue B",
        postalCode: "69001",
        city: "Lyon",
        country: "France",
      },
      pdf: Buffer.from(await pdf.save()),
    });
    assert.equal(attempts, 2);
    assert.match(idempotencyKey, /^lydoc-[a-f\d]{64}$/);
    assert.equal(isRetryablePostalStatus(503), true);
    assert.equal(isRetryablePostalStatus(400), false);
    assert.equal(
      postalRequestIdempotencyKey("preview", "case-retry"),
      postalRequestIdempotencyKey("preview", "case-retry"),
    );
  } finally {
    global.fetch = previousFetch;
    restoreEnv("POSTAL_PROVIDER", previous.provider);
    restoreEnv("SERVICE_POSTAL_API_KEY", previous.key);
    restoreEnv("SERVICE_POSTAL_ENV", previous.environment);
    restoreEnv("SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS", previous.attempts);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
