import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { access, mkdir, rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { PrismaService } from "../prisma/prisma.service";
import { parseTrustedProxyCidrs } from "../../platform/http-protection";

const executeFile = promisify(execFile);

@Controller("health")
export class HealthController {
  private readinessProbe:
    { expiresAt: number; promise: Promise<void> } | undefined;

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async readHealth() {
    const deployment = this.assertRuntimeConfiguration();
    await this.assertDependenciesReady();

    return {
      status: "ok",
      service: "lydoc-api",
      database: "ready",
      storage: "ready",
      catalog: "ready",
      localDocumentControl: "ready",
      ...deployment,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  @Get("live")
  readLiveness() {
    return { status: "ok", service: "lydoc-api" };
  }

  @Get("ready")
  async readReadiness() {
    const deployment = this.assertRuntimeConfiguration();
    await this.assertDependenciesReady();

    return {
      status: "ok",
      database: "ready",
      storage: "ready",
      catalog: "ready",
      localDocumentControl: "ready",
      ...deployment,
    };
  }

  private async assertDependenciesReady(): Promise<void> {
    const now = Date.now();
    if (this.readinessProbe && this.readinessProbe.expiresAt > now) {
      await this.readinessProbe.promise;
      return;
    }

    const promise = Promise.all([
      this.assertDatabaseReady(),
      this.assertStorageReady(),
      this.assertCatalogReady(),
      this.assertLocalDocumentControlReady(),
    ]).then(() => undefined);
    const probe = { expiresAt: now + 10_000, promise };
    this.readinessProbe = probe;
    try {
      await promise;
    } catch (error) {
      // Cache failures briefly as well so an unavailable dependency cannot be
      // hammered through this public endpoint.
      probe.expiresAt = Date.now() + 2_000;
      throw error;
    }
  }

  private async assertDatabaseReady(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const invalidGeneratedPackets = await this.prisma.generatedPacket.count({
        where: { sizeBytes: { lte: 0 } },
      });
      if (invalidGeneratedPackets > 0) {
        process.stderr.write(
          `${JSON.stringify({
            level: "error",
            type: "generated_packet_size_backfill_required",
            invalidGeneratedPacketCount: invalidGeneratedPackets,
            remediation:
              "Backfill exact GeneratedPacket.sizeBytes from encrypted storage or purge and regenerate before opening traffic.",
            timestamp: new Date().toISOString(),
          })}\n`,
        );
        throw new ServiceUnavailableException(
          "Inventaire des PDF generes incoherent.",
        );
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Base de donnees indisponible.");
    }
  }

  private async assertStorageReady(): Promise<void> {
    const directory =
      process.env.DOCUMENT_STORAGE_DIR ??
      join(process.cwd(), "../../var/storage");
    const probe = join(directory, `.health-${randomUUID()}`);
    try {
      await mkdir(directory, { recursive: true });
      await access(directory);
      const filesystem = await statfs(directory);
      const minimumFreeBytes = readInteger(
        process.env.DOCUMENT_STORAGE_MIN_FREE_BYTES,
      );
      if (
        minimumFreeBytes !== null &&
        BigInt(filesystem.bavail) * BigInt(filesystem.bsize) <
          BigInt(minimumFreeBytes)
      ) {
        throw new Error("storage reserve exhausted");
      }
      await writeFile(probe, "ok", { encoding: "utf8", flag: "wx" });
      await rm(probe, { force: true });
    } catch {
      await rm(probe, { force: true }).catch(() => undefined);
      throw new ServiceUnavailableException(
        "Stockage documentaire indisponible.",
      );
    }
  }

  private async assertCatalogReady(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;
    try {
      const now = new Date();
      const approvedRules = await this.prisma.gameRule.count({
        where: {
          status: "APPROVED",
          reimbursementCents: { gt: 0 },
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
          ],
          sourceDocument: { deletedAt: null },
        },
      });
      if (approvedRules < 1) {
        throw new Error("empty catalog");
      }
    } catch {
      throw new ServiceUnavailableException(
        "Catalogue de reglements approuves indisponible.",
      );
    }
  }

  private async assertLocalDocumentControlReady(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;
    try {
      await Promise.all([
        executeFile("pdftoppm", ["-v"], {
          timeout: 2_000,
          windowsHide: true,
          maxBuffer: 64 * 1024,
        }),
        executeFile("tesseract", ["--version"], {
          timeout: 2_000,
          windowsHide: true,
          maxBuffer: 64 * 1024,
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException(
        "Controle local de confidentialite indisponible.",
      );
    }
  }

  private assertRuntimeConfiguration(): {
    deploymentProfile: string;
    features: { managedPostal: boolean; notificationsRequired: boolean };
  } {
    const managedPostal = readBoolean(process.env.MANAGED_POSTAL_ENABLED);
    const notificationsRequired = readBoolean(
      process.env.NOTIFICATIONS_REQUIRED,
    );
    const profile = process.env.LYDOC_DEPLOYMENT_PROFILE?.trim().toLowerCase();

    if (process.env.NODE_ENV !== "production") {
      return {
        deploymentProfile: profile || "development",
        features: { managedPostal, notificationsRequired },
      };
    }

    const invalid: string[] = [];
    if (profile !== "free-beta" && profile !== "full") {
      invalid.push("LYDOC_DEPLOYMENT_PROFILE");
    }
    requireBoolean(invalid, "MANAGED_POSTAL_ENABLED");
    requireBoolean(invalid, "NOTIFICATIONS_REQUIRED");
    requireBoolean(invalid, "SERVICE_POSTAL_PRODUCTION_ENABLED");
    requireTrustedProductionProxy(invalid);
    requireConfigured(invalid, "SESSION_SECRET", { minimumLength: 32 });
    requireConfigured(invalid, "IDENTITY_OUTBOX_ENCRYPTION_SECRET", {
      minimumLength: 32,
    });
    requireConfigured(invalid, "MFA_ENCRYPTION_SECRET", {
      minimumLength: 32,
    });
    requireKeyId(invalid, "MFA_ENCRYPTION_KEY_ID");
    requirePreviousEncryptionKeys(invalid, {
      previousKeysName: "MFA_ENCRYPTION_PREVIOUS_KEYS",
      currentKeyIdName: "MFA_ENCRYPTION_KEY_ID",
    });
    requireConfigured(invalid, "DOCUMENT_ENCRYPTION_SECRET", {
      minimumLength: 32,
    });
    requireKeyId(invalid, "DOCUMENT_ENCRYPTION_KEY_ID");
    requirePreviousEncryptionKeys(invalid, {
      previousKeysName: "DOCUMENT_ENCRYPTION_PREVIOUS_KEYS",
      currentKeyIdName: "DOCUMENT_ENCRYPTION_KEY_ID",
    });
    if (
      process.env.MFA_ENCRYPTION_SECRET === process.env.SESSION_SECRET ||
      process.env.MFA_ENCRYPTION_SECRET ===
        process.env.DOCUMENT_ENCRYPTION_SECRET
    ) {
      invalid.push("MFA_ENCRYPTION_SECRET");
    }
    if (
      process.env.IDENTITY_OUTBOX_ENCRYPTION_SECRET ===
        process.env.SESSION_SECRET ||
      process.env.IDENTITY_OUTBOX_ENCRYPTION_SECRET ===
        process.env.MFA_ENCRYPTION_SECRET ||
      process.env.IDENTITY_OUTBOX_ENCRYPTION_SECRET ===
        process.env.DOCUMENT_ENCRYPTION_SECRET
    ) {
      invalid.push("IDENTITY_OUTBOX_ENCRYPTION_SECRET");
    }
    requireIntegerRange(invalid, "ADMIN_SESSION_TTL_MINUTES", 5, 60);
    requireIntegerRange(invalid, "AUTH_SCRYPT_CONCURRENCY", 1, 8);
    requireIntegerRange(invalid, "AUTH_SCRYPT_QUEUE_LIMIT", 1, 100);
    requireIntegerRange(invalid, "AUTH_EMAIL_DAILY_GLOBAL_LIMIT", 1, 100_000);
    requireIntegerRange(
      invalid,
      "AUTH_REGISTER_HOURLY_GLOBAL_LIMIT",
      1,
      10_000,
    );
    requireIntegerRange(invalid, "AUTH_RESEND_HOURLY_GLOBAL_LIMIT", 1, 10_000);
    requireIntegerRange(invalid, "AUTH_FORGOT_HOURLY_GLOBAL_LIMIT", 1, 10_000);
    requireIntegerRange(
      invalid,
      "AUTH_MFA_CHALLENGE_HOURLY_GLOBAL_LIMIT",
      1,
      10_000,
    );
    requireIntegerRange(
      invalid,
      "AUTH_REGISTER_HOURLY_IDENTIFIER_LIMIT",
      1,
      1_000,
    );
    requireIntegerRange(
      invalid,
      "AUTH_RESEND_HOURLY_IDENTIFIER_LIMIT",
      1,
      1_000,
    );
    requireIntegerRange(
      invalid,
      "AUTH_FORGOT_HOURLY_IDENTIFIER_LIMIT",
      1,
      1_000,
    );
    requireIntegerRange(
      invalid,
      "AUTH_MFA_CHALLENGE_HOURLY_IDENTIFIER_LIMIT",
      1,
      1_000,
    );
    requireIntegerRange(invalid, "AUTH_DISPATCH_MIN_RESPONSE_MS", 100, 1_000);
    requireIntegerRange(invalid, "AUTH_PENDING_USER_TTL_HOURS", 1, 720);
    requireIntegerRange(invalid, "AUTH_CLEANUP_INTERVAL_MINUTES", 5, 1_440);
    requireExact(invalid, "AUTH_EXPOSE_TEST_TOKENS", "false");
    requireIntegerRange(
      invalid,
      "IDENTITY_EMAIL_OUTBOX_INTERVAL_MS",
      250,
      60_000,
    );
    requireIntegerRange(invalid, "IDENTITY_EMAIL_OUTBOX_CONCURRENCY", 1, 5);
    requireIntegerRange(invalid, "IDENTITY_EMAIL_OUTBOX_BATCH_SIZE", 1, 50);
    requireIntegerRange(
      invalid,
      "IDENTITY_EMAIL_OUTBOX_LEASE_SECONDS",
      30,
      600,
    );
    requireIntegerRange(invalid, "IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS", 1, 20);
    requireConfigured(invalid, "MISTRAL_API_KEY", { minimumLength: 12 });
    requireConfigured(invalid, "RESEND_API_KEY", { prefix: "re_" });
    requireConfigured(invalid, "RESEND_FROM_EMAIL");
    requireEmail(invalid, "CONTACT_TO_EMAIL");
    requireEmail(invalid, "SECURITY_CONTACT_EMAIL");
    requireIntegerRange(invalid, "CONTACT_DAILY_LIMIT", 1, 10_000);
    requireIntegerRange(invalid, "CONTACT_DAILY_EMAIL_LIMIT", 1, 20);
    requireIntegerRange(invalid, "CONTACT_DAILY_CLIENT_LIMIT", 1, 200);
    requireIntegerRange(invalid, "CONTACT_HOURLY_ATTEMPT_LIMIT", 1, 10_000);
    requireIntegerRange(invalid, "CONTACT_HOURLY_EMAIL_ATTEMPT_LIMIT", 1, 100);
    requireIntegerRange(
      invalid,
      "CONTACT_HOURLY_CLIENT_ATTEMPT_LIMIT",
      1,
      1_000,
    );
    requireIntegerRange(
      invalid,
      "API_GENERAL_RATE_LIMIT_PER_MINUTE",
      10,
      10_000,
    );
    requireIntegerRange(invalid, "AI_DAILY_ACCOUNT_CALL_LIMIT", 0, 1_000);
    requireIntegerRange(invalid, "MISTRAL_DAILY_CALL_LIMIT", 0, 100_000);
    requireIntegerRange(invalid, "MISTRAL_MAX_CONCURRENT_REQUESTS", 1, 20);
    requireIntegerRange(invalid, "AI_LOCAL_DLP_CONCURRENCY", 1, 8);
    requireIntegerRange(invalid, "AI_LOCAL_DLP_MAX_PAGES", 1, 20);
    requireIntegerRange(
      invalid,
      "DOCUMENT_PENDING_UPLOAD_GLOBAL_BYTES",
      20_971_520,
      2_000_000_000,
    );
    requireIntegerRange(invalid, "DOCUMENT_UPLOAD_CONCURRENCY_GLOBAL", 1, 32);
    requireIntegerRange(invalid, "DOCUMENT_UPLOAD_CONCURRENCY_ACCOUNT", 1, 8);
    requireIntegerRange(
      invalid,
      "STORAGE_WRITE_RESERVATION_TTL_SECONDS",
      60,
      3_600,
    );
    requireIntegerRange(
      invalid,
      "DOCUMENT_STORAGE_MIN_FREE_BYTES",
      104_857_600,
      100_000_000_000_000,
    );
    requireIntegerRange(
      invalid,
      "DOCUMENT_STORAGE_GLOBAL_BYTES",
      1_073_741_824,
      1_000_000_000_000_000,
    );
    requireIntegerRange(invalid, "DOCUMENT_RETENTION_DAYS", 1, 3_650);
    requireIntegerRange(invalid, "SENSITIVE_DOCUMENT_RETENTION_DAYS", 1, 3_650);
    requireIntegerRange(invalid, "DOCUMENT_DELETION_GRACE_DAYS", 1, 365);
    requireIntegerRange(invalid, "DOCUMENT_MIGRATION_BACKUP_DAYS", 1, 365);
    requireExact(invalid, "DOCUMENT_RETENTION_AUTOMATION_ENABLED", "true");
    requireIntegerRange(
      invalid,
      "DOCUMENT_RETENTION_INTERVAL_MINUTES",
      1,
      1_440,
    );
    requireIntegerRange(invalid, "ACCOUNT_ERASURE_PURGE_GRACE_DAYS", 0, 30);
    requireIntegerRange(
      invalid,
      "ACCOUNT_LEGAL_RECORD_RETENTION_DAYS",
      365,
      4_000,
    );
    requireExact(invalid, "SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN", "false");
    requireIntegerRange(
      invalid,
      "SERVICE_POSTAL_WEBHOOK_TOLERANCE_SECONDS",
      1,
      3_600,
    );
    requireIntegerRange(
      invalid,
      "SERVICE_POSTAL_REQUEST_TIMEOUT_MS",
      1_000,
      30_000,
    );
    requireIntegerRange(invalid, "SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS", 1, 3);
    requireHttpsUrl(invalid, "APP_URL");
    requireHttpsUrl(invalid, "API_URL");

    const postalProvider = (process.env.POSTAL_PROVIDER ?? "")
      .trim()
      .toLowerCase();
    const postalProduction = readBoolean(
      process.env.SERVICE_POSTAL_PRODUCTION_ENABLED,
    );

    if (profile === "free-beta") {
      if (managedPostal) invalid.push("MANAGED_POSTAL_ENABLED");
      if (postalProvider !== "mock") invalid.push("POSTAL_PROVIDER");
      if (postalProduction) {
        invalid.push("SERVICE_POSTAL_PRODUCTION_ENABLED");
      }
    }

    if (managedPostal) {
      requireConfigured(invalid, "STRIPE_SECRET_KEY", { prefix: "sk_live_" });
      requireConfigured(invalid, "STRIPE_WEBHOOK_SECRET", {
        prefix: "whsec_",
      });
    }

    if (postalProvider === "service_postal") {
      requireConfigured(invalid, "SERVICE_POSTAL_API_KEY");
      requireConfigured(invalid, "SERVICE_POSTAL_WEBHOOK_SECRET", {
        minimumLength: 24,
      });
    }
    if (
      postalProduction &&
      (postalProvider !== "service_postal" ||
        process.env.SERVICE_POSTAL_ENV?.trim().toLowerCase() !== "production")
    ) {
      invalid.push("SERVICE_POSTAL_PRODUCTION_ENABLED");
    }

    if (invalid.length > 0) {
      const uniqueInvalid = [...new Set(invalid)];
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          type: "configuration_incomplete",
          invalid: uniqueInvalid,
          timestamp: new Date().toISOString(),
        })}\n`,
      );
      throw new ServiceUnavailableException(
        "Configuration de production incomplète.",
      );
    }

    return {
      deploymentProfile: profile ?? "invalid",
      features: { managedPostal, notificationsRequired },
    };
  }
}

function readBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function readInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function requireBoolean(invalid: string[], name: string): void {
  const value = process.env[name]?.trim().toLowerCase();
  if (value !== "true" && value !== "false") invalid.push(name);
}

function requireTrustedProductionProxy(invalid: string[]): void {
  if (process.env.TRUST_PROXY?.trim().toLowerCase() !== "true") {
    invalid.push("TRUST_PROXY");
    return;
  }
  try {
    parseTrustedProxyCidrs(true, process.env.TRUST_PROXY_CIDRS, true);
  } catch {
    invalid.push("TRUST_PROXY_CIDRS");
  }
}

function requirePreviousEncryptionKeys(
  invalid: string[],
  names: { previousKeysName: string; currentKeyIdName: string },
): void {
  const raw = process.env[names.previousKeysName]?.trim();
  if (!raw) return;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      invalid.push(names.previousKeysName);
      return;
    }
    const currentKeyId = process.env[names.currentKeyIdName]?.trim();
    for (const [keyId, secret] of Object.entries(parsed)) {
      if (
        !/^[A-Za-z0-9_-]{1,48}$/.test(keyId) ||
        keyId === currentKeyId ||
        typeof secret !== "string" ||
        secret.length < 32 ||
        isPlaceholder(secret)
      ) {
        invalid.push(names.previousKeysName);
        return;
      }
    }
  } catch {
    invalid.push(names.previousKeysName);
  }
}

function requireKeyId(invalid: string[], name: string): void {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(process.env[name]?.trim() ?? "")) {
    invalid.push(name);
  }
}

function requireConfigured(
  invalid: string[],
  name: string,
  options: { minimumLength?: number; prefix?: string } = {},
): void {
  const value = process.env[name]?.trim() ?? "";
  if (
    !value ||
    isPlaceholder(value) ||
    (options.minimumLength !== undefined &&
      value.length < options.minimumLength) ||
    (options.prefix !== undefined && !value.startsWith(options.prefix))
  ) {
    invalid.push(name);
  }
}

function requireHttpsUrl(invalid: string[], name: string): void {
  const value = process.env[name]?.trim() ?? "";
  try {
    if (new URL(value).protocol !== "https:" || isPlaceholder(value)) {
      invalid.push(name);
    }
  } catch {
    invalid.push(name);
  }
}

function requireEmail(invalid: string[], name: string): void {
  const value = process.env[name]?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || isPlaceholder(value)) {
    invalid.push(name);
  }
}

function requireIntegerRange(
  invalid: string[],
  name: string,
  minimum: number,
  maximum: number,
): void {
  const raw = process.env[name]?.trim() ?? "";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalid.push(name);
  }
}

function requireExact(invalid: string[], name: string, expected: string): void {
  if (process.env[name] !== expected) invalid.push(name);
}

function isPlaceholder(value: string): boolean {
  return /(change[_-]?me|replace-with|example\.(com|invalid)|your[-_])/i.test(
    value,
  );
}
