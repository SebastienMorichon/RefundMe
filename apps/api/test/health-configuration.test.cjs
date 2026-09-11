const assert = require("node:assert/strict");
const test = require("node:test");
const {
  HealthController,
} = require("../dist/modules/health/health.controller.js");

const validProductionEnvironment = Object.freeze({
  NODE_ENV: "production",
  LYDOC_DEPLOYMENT_PROFILE: "free-beta",
  MANAGED_POSTAL_ENABLED: "false",
  NOTIFICATIONS_REQUIRED: "false",
  POSTAL_PROVIDER: "mock",
  SERVICE_POSTAL_PRODUCTION_ENABLED: "false",
  SERVICE_POSTAL_ENV: "sandbox",
  SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN: "false",
  SERVICE_POSTAL_WEBHOOK_TOLERANCE_SECONDS: "300",
  SERVICE_POSTAL_REQUEST_TIMEOUT_MS: "10000",
  SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS: "2",
  TRUST_PROXY: "true",
  TRUST_PROXY_CIDRS: "172.28.0.1/32",
  SESSION_SECRET: "session-secret-that-is-longer-than-thirty-two-characters",
  IDENTITY_OUTBOX_ENCRYPTION_SECRET:
    "identity-outbox-secret-independent-and-longer-than-thirty-two",
  MFA_ENCRYPTION_SECRET:
    "mfa-secret-that-is-independent-and-longer-than-thirty-two",
  MFA_ENCRYPTION_KEY_ID: "mfa-current",
  MFA_ENCRYPTION_PREVIOUS_KEYS: "{}",
  ADMIN_SESSION_TTL_MINUTES: "30",
  AUTH_SCRYPT_CONCURRENCY: "2",
  AUTH_SCRYPT_QUEUE_LIMIT: "8",
  AUTH_EMAIL_DAILY_GLOBAL_LIMIT: "500",
  AUTH_REGISTER_HOURLY_GLOBAL_LIMIT: "100",
  AUTH_RESEND_HOURLY_GLOBAL_LIMIT: "100",
  AUTH_FORGOT_HOURLY_GLOBAL_LIMIT: "100",
  AUTH_MFA_CHALLENGE_HOURLY_GLOBAL_LIMIT: "200",
  AUTH_REGISTER_HOURLY_IDENTIFIER_LIMIT: "10",
  AUTH_RESEND_HOURLY_IDENTIFIER_LIMIT: "5",
  AUTH_FORGOT_HOURLY_IDENTIFIER_LIMIT: "5",
  AUTH_MFA_CHALLENGE_HOURLY_IDENTIFIER_LIMIT: "5",
  AUTH_DISPATCH_MIN_RESPONSE_MS: "250",
  AUTH_PENDING_USER_TTL_HOURS: "48",
  AUTH_CLEANUP_INTERVAL_MINUTES: "60",
  AUTH_EXPOSE_TEST_TOKENS: "false",
  IDENTITY_EMAIL_OUTBOX_INTERVAL_MS: "1000",
  IDENTITY_EMAIL_OUTBOX_CONCURRENCY: "2",
  IDENTITY_EMAIL_OUTBOX_BATCH_SIZE: "10",
  IDENTITY_EMAIL_OUTBOX_LEASE_SECONDS: "120",
  IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS: "6",
  DOCUMENT_ENCRYPTION_SECRET:
    "document-secret-that-is-independent-and-longer-than-thirty-two",
  DOCUMENT_ENCRYPTION_KEY_ID: "documents-current",
  DOCUMENT_ENCRYPTION_PREVIOUS_KEYS: "{}",
  DOCUMENT_PENDING_UPLOAD_GLOBAL_BYTES: "524288000",
  DOCUMENT_UPLOAD_CONCURRENCY_GLOBAL: "4",
  DOCUMENT_UPLOAD_CONCURRENCY_ACCOUNT: "2",
  STORAGE_WRITE_RESERVATION_TTL_SECONDS: "900",
  DOCUMENT_STORAGE_MIN_FREE_BYTES: "1073741824",
  DOCUMENT_STORAGE_GLOBAL_BYTES: "107374182400",
  DOCUMENT_RETENTION_DAYS: "365",
  SENSITIVE_DOCUMENT_RETENTION_DAYS: "30",
  DOCUMENT_DELETION_GRACE_DAYS: "7",
  DOCUMENT_MIGRATION_BACKUP_DAYS: "7",
  DOCUMENT_RETENTION_AUTOMATION_ENABLED: "true",
  DOCUMENT_RETENTION_INTERVAL_MINUTES: "360",
  ACCOUNT_ERASURE_PURGE_GRACE_DAYS: "7",
  ACCOUNT_LEGAL_RECORD_RETENTION_DAYS: "3650",
  MISTRAL_API_KEY: "mistral-production-test-key",
  AI_DAILY_ACCOUNT_CALL_LIMIT: "10",
  MISTRAL_DAILY_CALL_LIMIT: "1000",
  MISTRAL_MAX_CONCURRENT_REQUESTS: "2",
  AI_LOCAL_DLP_CONCURRENCY: "2",
  AI_LOCAL_DLP_MAX_PAGES: "6",
  RESEND_API_KEY: "re_production_test_key",
  RESEND_FROM_EMAIL: "Lydoc <notifications@lydoc.test>",
  CONTACT_TO_EMAIL: "support@lydoc.test",
  SECURITY_CONTACT_EMAIL: "security@lydoc.test",
  CONTACT_DAILY_LIMIT: "200",
  CONTACT_DAILY_EMAIL_LIMIT: "3",
  CONTACT_DAILY_CLIENT_LIMIT: "20",
  CONTACT_HOURLY_ATTEMPT_LIMIT: "400",
  CONTACT_HOURLY_EMAIL_ATTEMPT_LIMIT: "10",
  CONTACT_HOURLY_CLIENT_ATTEMPT_LIMIT: "40",
  API_GENERAL_RATE_LIMIT_PER_MINUTE: "120",
  APP_URL: "https://app.lydoc.test",
  API_URL: "https://api.lydoc.test",
});

test("production readiness accepts an explicitly bounded free-beta profile", () => {
  withEnvironment(validProductionEnvironment, () => {
    const controller = new HealthController({});
    const status = controller.assertRuntimeConfiguration();
    assert.equal(status.deploymentProfile, "free-beta");
    assert.deepEqual(status.features, {
      managedPostal: false,
      notificationsRequired: false,
    });
  });
});

test("full paid profile requires SumUp and accepts manual postal fulfillment", () => {
  withEnvironment(
    {
      ...validProductionEnvironment,
      LYDOC_DEPLOYMENT_PROFILE: "full",
      MANAGED_POSTAL_ENABLED: "true",
      POSTAL_PROVIDER: "manual",
      SUMUP_API_KEY: "sup_sk_live_test_key_long_enough",
      SUMUP_MERCHANT_CODE: "MC123456",
    },
    () => {
      const controller = new HealthController({});
      assert.equal(
        controller.assertRuntimeConfiguration().features.managedPostal,
        true,
      );
    },
  );
});

for (const [name, value] of [
  ["DOCUMENT_RETENTION_AUTOMATION_ENABLED", "false"],
  ["AUTH_EXPOSE_TEST_TOKENS", "true"],
  ["MISTRAL_MAX_CONCURRENT_REQUESTS", "100"],
  ["DOCUMENT_PENDING_UPLOAD_GLOBAL_BYTES", "1"],
  ["IDENTITY_EMAIL_OUTBOX_CONCURRENCY", "20"],
  ["ACCOUNT_LEGAL_RECORD_RETENTION_DAYS", "30"],
  ["API_GENERAL_RATE_LIMIT_PER_MINUTE", "0"],
  ["STORAGE_WRITE_RESERVATION_TTL_SECONDS", "30"],
]) {
  test(`production readiness rejects unsafe ${name}`, () => {
    withEnvironment({ ...validProductionEnvironment, [name]: value }, () => {
      const controller = new HealthController({});
      assert.throws(
        () => controller.assertRuntimeConfiguration(),
        /Configuration de production/i,
      );
    });
  });
}

test("production readiness rejects a reused MFA encryption secret", () => {
  withEnvironment(
    {
      ...validProductionEnvironment,
      MFA_ENCRYPTION_SECRET: validProductionEnvironment.SESSION_SECRET,
    },
    () => {
      const controller = new HealthController({});
      assert.throws(
        () => controller.assertRuntimeConfiguration(),
        /Configuration de production/i,
      );
    },
  );
});

test("production readiness rejects a reused identity outbox secret", () => {
  withEnvironment(
    {
      ...validProductionEnvironment,
      IDENTITY_OUTBOX_ENCRYPTION_SECRET:
        validProductionEnvironment.SESSION_SECRET,
    },
    () => {
      const controller = new HealthController({});
      assert.throws(
        () => controller.assertRuntimeConfiguration(),
        /Configuration de production/i,
      );
    },
  );
});

test("production readiness requires one exact trusted proxy host", () => {
  for (const override of [
    { TRUST_PROXY: "false" },
    { TRUST_PROXY_CIDRS: "172.28.0.0/24" },
    { TRUST_PROXY_CIDRS: "0.0.0.0/0" },
  ]) {
    withEnvironment({ ...validProductionEnvironment, ...override }, () => {
      const controller = new HealthController({});
      assert.throws(
        () => controller.assertRuntimeConfiguration(),
        /Configuration de production/i,
      );
    });
  }
});

test("database readiness fails closed on legacy generated packets without an exact size", async () => {
  let countWhere;
  const controller = new HealthController({
    $queryRaw: async () => [{ ready: 1 }],
    generatedPacket: {
      count: async ({ where }) => {
        countWhere = where;
        return 2;
      },
    },
  });

  await assert.rejects(
    controller.assertDatabaseReady(),
    /Inventaire des PDF generes incoherent/,
  );
  assert.deepEqual(countWhere, { sizeBytes: { lte: 0 } });
});

test("database readiness accepts an exact generated-packet inventory", async () => {
  const controller = new HealthController({
    $queryRaw: async () => [{ ready: 1 }],
    generatedPacket: { count: async () => 0 },
  });

  await controller.assertDatabaseReady();
});

function withEnvironment(values, run) {
  const previous = new Map();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
