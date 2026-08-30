const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { PDFDocument } = require("pdf-lib");

const {
  EligibilityService,
  caseAttachmentBlockReason,
  caseDeletionBlockReason,
} = require("../dist/modules/eligibility/eligibility.service.js");
const {
  PacketsService,
  assertPacketAggregateLimits,
  packetSafetyLimits,
} = require("../dist/modules/packets/packets.service.js");
const {
  PaymentsService,
} = require("../dist/modules/payments/payments.service.js");
const {
  ProfileController,
} = require("../dist/modules/identity/profile.controller.js");
const {
  ShippingService,
} = require("../dist/modules/shipping/shipping.service.js");
const {
  isIpRateLimitedPath,
  rateLimitBucketPath,
} = require("../dist/platform/http-protection.js");

test("financial and generated history freezes destructive case mutations", () => {
  assert.equal(
    caseDeletionBlockReason({
      status: "READY_TO_PAY",
      paymentStatus: "PENDING",
      postalShipmentStatus: "QUOTED",
      postalProviderUid: "postal-1",
      generatedPacketCount: 0,
    }),
    "PAYMENT_PENDING",
  );
  for (const status of [
    "GENERATED",
    "PRINT_READY",
    "PAID",
    "SENT",
    "REFUNDED",
  ]) {
    assert.match(
      caseAttachmentBlockReason({
        status,
        paymentStatus: null,
        generatedPacketCount: 0,
      }),
      /^CASE_STATUS_/,
    );
  }
  assert.equal(
    caseAttachmentBlockReason({
      status: "READY_TO_PAY",
      paymentStatus: "PENDING",
      generatedPacketCount: 0,
    }),
    "PAYMENT_PENDING",
  );
  assert.equal(
    caseAttachmentBlockReason({
      status: "READY_TO_PAY",
      paymentStatus: null,
      generatedPacketCount: 1,
    }),
    "PACKET_GENERATED",
  );
});

test("deleteCase rechecks PENDING under both transaction locks", async () => {
  const locks = [];
  let deleted = false;
  const transaction = {
    $executeRaw(strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    administrativeCase: {
      findFirst: async () => ({
        id: "case-1",
        status: "READY_TO_PAY",
        payment: { status: "PENDING" },
        postalShipment: { status: "QUOTED", providerUid: "postal-1" },
        _count: { generatedPackets: 0 },
      }),
      delete: async () => {
        deleted = true;
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    $transaction: async (operation) => operation(transaction),
  };
  const service = new EligibilityService(prisma, {}, { sendCaseEvent() {} });
  await assert.rejects(
    () => service.deleteCase("case-1", "user-1"),
    /paiement est encore ouvert/i,
  );
  assert.deepEqual(locks, [
    "customer-profile:user-1",
    "stripe-checkout:case-1",
    "generated-packet:case-1",
  ]);
  assert.equal(deleted, false);
});

test("profile update is rejected before mutation while any checkout is pending", async () => {
  const locks = [];
  let userUpdated = false;
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    administrativeCase: {
      findMany: async () => [{ id: "case-1" }, { id: "case-2" }],
    },
    payment: { findFirst: async () => ({ id: "payment-1" }) },
    user: {
      findFirst: async () => ({ id: "user-1" }),
      update: async () => {
        userUpdated = true;
      },
    },
  };
  const controller = new ProfileController({
    $transaction: async (operation) => operation(transaction),
  });
  await assert.rejects(
    () =>
      controller.update(
        {
          firstName: "Jeanne",
          lastName: "Dupont",
          postalAddress: "1 rue de Paris",
          postalCode: "75001",
          city: "Paris",
          country: "France",
          phoneNumber: "06 12 34 56 78",
          operatorCustomerReference: "REF-1",
        },
        { user: { id: "user-1" } },
      ),
    /paiement Stripe est ouvert/i,
  );
  assert.deepEqual(locks, [
    "customer-profile:user-1",
    "stripe-checkout:case-1",
    "generated-packet:case-1",
    "stripe-checkout:case-2",
    "generated-packet:case-2",
  ]);
  assert.equal(userUpdated, false);
});

test("profile update rechecks the active account under the customer lock", async () => {
  const locks = [];
  let mutationAttempted = false;
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    user: {
      findFirst: async () => null,
      updateMany: async () => {
        mutationAttempted = true;
        return { count: 1 };
      },
    },
    administrativeCase: {
      findMany: async () => {
        mutationAttempted = true;
        return [];
      },
    },
    payment: {
      findFirst: async () => {
        mutationAttempted = true;
        return null;
      },
    },
  };
  const controller = new ProfileController({
    $transaction: async (operation) => operation(transaction),
  });

  await assert.rejects(
    () =>
      controller.update(
        {
          firstName: "Jeanne",
          lastName: "Dupont",
          postalAddress: "1 rue de Paris",
          postalCode: "75001",
          city: "Paris",
          country: "France",
          phoneNumber: "06 12 34 56 78",
          operatorCustomerReference: "REF-1",
        },
        { user: { id: "user-1" } },
      ),
    /Session invalide/i,
  );
  assert.deepEqual(locks, ["customer-profile:user-1"]);
  assert.equal(mutationAttempted, false);
});

test("paid webhook updates only the exact PENDING payment under the checkout lock", async () => {
  const locks = [];
  let paymentWhere;
  let shipped = 0;
  const payment = {
    id: "payment-1",
    caseId: "case-1",
    status: "PENDING",
    amountCents: 799,
    currency: "eur",
    stripeCheckoutSession: "cs_exact",
    paidAt: null,
  };
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    payment: {
      findUnique: async () => payment,
      updateMany: async ({ where }) => {
        paymentWhere = where;
        return { count: 1 };
      },
    },
    administrativeCase: { updateMany: async () => ({ count: 1 }) },
    auditLog: { create: async () => ({}) },
  };
  const service = new PaymentsService(
    { $transaction: async (operation) => operation(transaction) },
    {
      submitPaidCase: async () => {
        shipped += 1;
      },
    },
    { sendCaseEvent: async () => {} },
  );
  await service.markCheckoutPaid({
    id: "cs_exact",
    payment_status: "paid",
    amount_total: 799,
    currency: "eur",
    payment_intent: "pi_exact",
    metadata: { caseId: "case-1" },
  });
  assert.deepEqual(locks, ["stripe-checkout:case-1"]);
  assert.deepEqual(paymentWhere, {
    id: "payment-1",
    caseId: "case-1",
    status: "PENDING",
    stripeCheckoutSession: "cs_exact",
    amountCents: 799,
    currency: "eur",
  });
  assert.equal(shipped, 1);
});

test("a generated packet is served from persistent encrypted storage", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  let reads = 0;
  let writes = 0;
  const packet = {
    id: "packet-1",
    storageBucket: "local-documents",
    storageKey: "2026-08-03/00000000-0000-4000-8000-000000000001.bin",
    checksumSha256,
    sizeBytes: bytes.byteLength,
    createdAt: new Date("2026-08-03T10:00:00.000Z"),
  };
  const transaction = {
    $executeRaw: async () => 0,
    generatedPacket: { findFirst: async () => packet },
    administrativeCase: {
      findFirst: async () => ({ id: "case-1" }),
      updateMany: async () => ({ count: 0 }),
    },
    document: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => ({}) },
  };
  const service = new PacketsService(
    {
      administrativeCase: {
        findFirst: async () => ({
          id: "case-1",
          status: "GENERATED",
          gameRule: {},
          generatedPackets: [packet],
        }),
      },
      $transaction: async (operation) => operation(transaction),
    },
    {
      getDecryptedObject: async () => {
        reads += 1;
        return bytes;
      },
      putEncryptedObject: async () => {
        writes += 1;
      },
    },
  );
  const result = await service.generate("case-1", "user-1");
  assert.equal(result.preview, false);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(reads, 1);
  assert.equal(writes, 0);
});

test("a newly persisted packet records the exact stored byte size", async () => {
  const expectedCaseUpdatedAt = new Date("2026-08-10T08:00:00.000Z");
  const createdAt = new Date("2026-08-10T08:01:00.000Z");
  const stored = {
    bucket: "local-documents",
    key: "2026-08-10/00000000-0000-4000-8000-000000000002.bin",
    checksumSha256: "a".repeat(64),
    sizeBytes: 4_321,
  };
  let createData;
  let deleteCalls = 0;
  let storageReservation = null;
  const transaction = {
    $executeRaw: async () => 0,
    administrativeCase: {
      findFirst: async () => ({ id: "case-1" }),
      findUnique: async () => ({ updatedAt: expectedCaseUpdatedAt }),
    },
    generatedPacket: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
      findFirst: async () => null,
      create: async ({ data }) => {
        createData = data;
        return { id: "packet-new", ...data, createdAt };
      },
    },
    document: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
      updateMany: async () => ({ count: 0 }),
    },
    documentStorageRevision: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    storagePurgeJob: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    documentUploadReservation: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    storageWriteReservation: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
      create: async ({ data }) => {
        storageReservation = { id: "storage-reservation-1", ...data };
        return { id: storageReservation.id };
      },
      findUnique: async () => storageReservation,
      updateMany: async ({ data }) => {
        if (!storageReservation) return { count: 0 };
        storageReservation = { ...storageReservation, ...data };
        return { count: 1 };
      },
      deleteMany: async () => {
        const count = storageReservation ? 1 : 0;
        storageReservation = null;
        return { count };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const service = new PacketsService(
    {
      generatedPacket: { findFirst: async () => null },
      $transaction: async (operation) => operation(transaction),
    },
    {
      putEncryptedObject: async () => stored,
      deleteObject: async () => {
        deleteCalls += 1;
      },
    },
  );

  const packet = await service.persistGeneratedPacket({
    caseId: "case-1",
    ownerId: "user-1",
    bytes: new Uint8Array(stored.sizeBytes),
    source: "POSTAL_PREPARATION",
    expectedCaseUpdatedAt,
  });

  assert.equal(createData.sizeBytes, stored.sizeBytes);
  assert.equal(packet.sizeBytes, stored.sizeBytes);
  assert.equal(deleteCalls, 0);
  assert.equal(storageReservation, null);
});

test("a packet admitted before account deletion is not returned after deletion commits", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const packet = {
    id: "packet-1",
    storageBucket: "local-documents",
    storageKey: "2026-08-03/00000000-0000-4000-8000-000000000001.bin",
    checksumSha256,
    sizeBytes: bytes.byteLength,
    createdAt: new Date("2026-08-03T10:00:00.000Z"),
  };
  const locks = [];
  let accountActive = true;
  let reads = 0;
  let auditWrites = 0;
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    administrativeCase: {
      findFirst: async () => (accountActive ? { id: "case-1" } : null),
      updateMany: async () => ({ count: 0 }),
    },
    generatedPacket: { findFirst: async () => packet },
    document: { updateMany: async () => ({ count: 0 }) },
    auditLog: {
      create: async () => {
        auditWrites += 1;
        return {};
      },
    },
  };
  const service = new PacketsService(
    {
      administrativeCase: {
        findFirst: async () => ({
          id: "case-1",
          status: "GENERATED",
          gameRule: {},
          generatedPackets: [packet],
        }),
      },
      $transaction: async (operation) => operation(transaction),
    },
    {
      getDecryptedObject: async () => {
        reads += 1;
        accountActive = false;
        return bytes;
      },
    },
  );

  await assert.rejects(
    () => service.generate("case-1", "user-1"),
    /Dossier introuvable/i,
  );
  assert.equal(reads, 1);
  assert.equal(auditWrites, 0);
  assert.deepEqual(locks, [
    "customer-profile:user-1",
    "stripe-checkout:case-1",
    "generated-packet:case-1",
    "customer-profile:user-1",
    "stripe-checkout:case-1",
    "generated-packet:case-1",
  ]);
});

test("packet limits reject excessive count and aggregate bytes", () => {
  const oneByte = { bytes: new Uint8Array(1) };
  assert.throws(
    () =>
      assertPacketAggregateLimits(
        Array.from(
          { length: packetSafetyLimits.attachmentCount + 1 },
          () => oneByte,
        ),
      ),
    /plus de/i,
  );
  assert.throws(
    () =>
      assertPacketAggregateLimits([
        {
          bytes: new Uint8Array(packetSafetyLimits.singleAttachmentBytes + 1),
        },
      ]),
    /taille maximale/i,
  );
});

test("all case PDF identifiers share one IP rate-limit bucket", () => {
  assert.equal(isIpRateLimitedPath("/cases/case-1/dossier.pdf"), true);
  assert.equal(
    rateLimitBucketPath("/cases/case-1/dossier.pdf"),
    "/cases/:id/dossier.pdf",
  );
  assert.equal(
    rateLimitBucketPath("/cases/case-2/dossier.pdf"),
    "/cases/:id/dossier.pdf",
  );
});

test("ambiguous postal submission stays SUBMITTING for reconciliation", async () => {
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
  process.env.SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS = "1";
  global.fetch = async () => {
    throw new Error("response lost after write");
  };
  const updates = [];
  const audits = [];
  const shipment = {
    id: "shipment-1",
    status: "QUOTED",
    providerUid: "postal-1",
    provider: "service_postal",
    environment: "sandbox",
    totalCents: 500,
  };
  const transaction = {
    $executeRaw: async () => 0,
    administrativeCase: {
      findUnique: async () => ({ ownerId: "user-1" }),
      findFirst: async () => ({
        id: "case-1",
        ownerId: "user-1",
        status: "PAID",
        fulfillmentMode: "MANAGED_POSTAL",
        serviceFeeCents: 299,
        payment: { status: "PAID", amountCents: 799 },
        postalShipment: shipment,
      }),
    },
    postalShipment: {
      updateMany: async (input) => {
        updates.push(input);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return {};
      },
    },
  };
  const prisma = {
    $transaction: async (operation) => operation(transaction),
  };
  try {
    const service = new ShippingService(
      prisma,
      {},
      {},
      { sendCaseEvent: async () => {} },
    );
    await service.submitPaidCase("case-1");
    assert.equal(updates.length, 2);
    assert.equal(updates[0].data.status, "SUBMITTING");
    assert.equal(updates[1].where.status, "SUBMITTING");
    assert.equal(updates[1].data.status, undefined);
    assert.match(updates[1].data.errorMessage, /reconciliation/i);
    assert.equal(audits[0].action, "POSTAL_SUBMISSION_OUTCOME_UNKNOWN");
  } finally {
    global.fetch = previousFetch;
    restoreEnv("POSTAL_PROVIDER", previous.provider);
    restoreEnv("SERVICE_POSTAL_API_KEY", previous.key);
    restoreEnv("SERVICE_POSTAL_ENV", previous.environment);
    restoreEnv("SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS", previous.attempts);
  }
});

test("a database failure after provider acceptance never downgrades the shipment to FAILED", async () => {
  const previous = {
    provider: process.env.POSTAL_PROVIDER,
    key: process.env.SERVICE_POSTAL_API_KEY,
    environment: process.env.SERVICE_POSTAL_ENV,
  };
  const previousFetch = global.fetch;
  process.env.POSTAL_PROVIDER = "service_postal";
  process.env.SERVICE_POSTAL_API_KEY = "sandbox-key";
  process.env.SERVICE_POSTAL_ENV = "sandbox";
  global.fetch = async () =>
    new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const updates = [];
  const audits = [];
  const shipment = {
    id: "shipment-1",
    status: "QUOTED",
    providerUid: "postal-1",
    provider: "service_postal",
    environment: "sandbox",
    totalCents: 500,
  };
  const transaction = {
    $executeRaw: async () => 0,
    administrativeCase: {
      findUnique: async () => ({ ownerId: "user-1" }),
      findFirst: async () => ({
        id: "case-1",
        ownerId: "user-1",
        status: "PAID",
        fulfillmentMode: "MANAGED_POSTAL",
        serviceFeeCents: 299,
        payment: { status: "PAID", amountCents: 799 },
        postalShipment: shipment,
      }),
    },
    postalShipment: {
      updateMany: async (input) => {
        updates.push(input);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return {};
      },
    },
  };
  let transactionCalls = 0;
  const prisma = {
    $transaction: async (operation) => {
      transactionCalls += 1;
      if (transactionCalls === 2) {
        throw new Error("database unavailable after provider acceptance");
      }
      return operation(transaction);
    },
  };

  try {
    const service = new ShippingService(
      prisma,
      {},
      {},
      { sendCaseEvent: async () => {} },
    );
    await service.submitPaidCase("case-1");
    assert.equal(updates[0].data.status, "SUBMITTING");
    assert.equal(updates[1].where.status, "SUBMITTING");
    assert.equal(updates[1].data.status, undefined);
    assert.match(updates[1].data.errorMessage, /reconciliation/i);
    assert.equal(audits[0].action, "POSTAL_SUBMISSION_OUTCOME_UNKNOWN");
    assert.equal(
      updates.some(({ data }) => data.status === "FAILED"),
      false,
    );
  } finally {
    global.fetch = previousFetch;
    restoreEnv("POSTAL_PROVIDER", previous.provider);
    restoreEnv("SERVICE_POSTAL_API_KEY", previous.key);
    restoreEnv("SERVICE_POSTAL_ENV", previous.environment);
  }
});

test("an in-flight postal call cannot be marked refunded until its outcome is known", async () => {
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
  process.env.SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS = "1";

  const state = {
    caseStatus: "PAID",
    shipmentStatus: "QUOTED",
    providerRequestId: null,
  };
  let releaseProvider;
  const providerReleased = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  let signalProviderStarted;
  const providerStarted = new Promise((resolve) => {
    signalProviderStarted = resolve;
  });
  let providerCalls = 0;
  global.fetch = async () => {
    providerCalls += 1;
    assert.equal(state.caseStatus, "PAID");
    assert.equal(state.shipmentStatus, "SUBMITTING");
    signalProviderStarted();
    await providerReleased;
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const currentCase = () => ({
    id: "case-1",
    ownerId: "user-1",
    status: state.caseStatus,
    fulfillmentMode: "MANAGED_POSTAL",
    serviceFeeCents: 299,
    estimatedRecoverableCents: 500,
    validatedAt: new Date(),
    gameRule: {},
    payment: { status: "PAID", amountCents: 799 },
    postalShipment: {
      id: "shipment-1",
      status: state.shipmentStatus,
      providerUid: "postal-1",
      provider: "service_postal",
      environment: "sandbox",
      totalCents: 500,
      providerRequestId: state.providerRequestId,
    },
  });
  const transaction = {
    $executeRaw: async () => 0,
    administrativeCase: {
      findUnique: async () => currentCase(),
      findFirst: async () => currentCase(),
      updateMany: async ({ where, data }) => {
        if (where.status === "PAID" && state.caseStatus === "PAID") {
          state.caseStatus = data.status;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    postalShipment: {
      updateMany: async ({ where, data }) => {
        const expectedStatuses = Array.isArray(where.status?.in)
          ? where.status.in
          : [where.status];
        if (!expectedStatuses.includes(state.shipmentStatus)) {
          return { count: 0 };
        }
        if (
          where.providerRequestId &&
          where.providerRequestId !== state.providerRequestId
        ) {
          return { count: 0 };
        }
        if (data.status) state.shipmentStatus = data.status;
        if (data.providerRequestId) {
          state.providerRequestId = data.providerRequestId;
        }
        return { count: 1 };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    $transaction: async (operation) => operation(transaction),
  };

  try {
    const shipping = new ShippingService(
      prisma,
      {},
      {},
      { sendCaseEvent: async () => {} },
    );
    const eligibility = new EligibilityService(
      prisma,
      {},
      { sendCaseEvent: async () => {} },
    );
    const submission = shipping.submitPaidCase("case-1");
    await providerStarted;

    await assert.rejects(
      () => eligibility.markRefunded("case-1", "user-1"),
      /traitement postal/i,
    );
    assert.equal(state.caseStatus, "PAID");
    assert.equal(state.shipmentStatus, "SUBMITTING");

    releaseProvider();
    await submission;
    assert.equal(providerCalls, 1);
    assert.equal(state.shipmentStatus, "SUBMITTED");
    assert.equal(state.caseStatus, "PRINT_READY");
  } finally {
    releaseProvider?.();
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
