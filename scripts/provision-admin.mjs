import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export async function provisionAdmin(options) {
  const email = normalizeEmail(options.email);
  const keyId = requireKeyId(process.env.MFA_ENCRYPTION_KEY_ID);
  const encryptionSecret = requireDedicatedSecret(
    process.env.MFA_ENCRYPTION_SECRET,
  );
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const prisma = options.prisma ?? new PrismaClient();
  const ownsPrisma = !options.prisma;
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerifiedAt: true,
        accountDeletedAt: true,
        mfaEnabledAt: true,
        mfaSecretEncrypted: true,
      },
    });
    if (!user?.emailVerifiedAt || user.accountDeletedAt) {
      throw new Error("A verified account with this e-mail is required.");
    }

    const secret = encodeBase32(randomBytes(20));
    const encryptedSecret = encryptMfaSecretForCli({
      userId: user.id,
      keyId,
      encryptionSecret,
      secret,
    });
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: options.rotate
          ? {
              id: user.id,
              role: "ADMIN",
              emailVerifiedAt: { not: null },
              accountDeletedAt: null,
              mfaEnabledAt: { not: null },
              mfaSecretEncrypted: { not: null },
            }
          : {
              id: user.id,
              role: "USER",
              emailVerifiedAt: { not: null },
              accountDeletedAt: null,
              mfaEnabledAt: null,
              mfaSecretEncrypted: null,
            },
        data: {
          role: "ADMIN",
          mfaSecretEncrypted: encryptedSecret,
          mfaEnabledAt: now,
          mfaLastUsedStep: null,
        },
      });
      if (updated.count !== 1) {
        throw new Error(
          options.rotate
            ? "Rotation refused: the account is not an active MFA administrator."
            : "Provisioning refused: use --rotate for an existing administrator.",
        );
      }
      await transaction.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.identityToken.updateMany({
        where: {
          userId: user.id,
          purpose: "ADMIN_MFA_LOGIN",
          usedAt: null,
        },
        data: { usedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: options.rotate
            ? "ADMIN_MFA_ROTATED"
            : "ADMIN_MFA_PROVISIONED",
          entityType: "User",
          entityId: user.id,
          metadata: {
            source: "CLI",
            keyId,
            provisionedAt: now.toISOString(),
          },
        },
      });
    });

    return {
      email: user.email,
      secret,
      provisioningUri: provisioningUri(user.email, secret),
      rotated: Boolean(options.rotate),
    };
  } finally {
    if (ownsPrisma) await prisma.$disconnect();
  }
}

export function encryptMfaSecretForCli(input) {
  const iv = randomBytes(12);
  const key = createHash("sha256")
    .update("lydoc-admin-mfa-encryption-v1\0")
    .update(input.encryptionSecret)
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(
    Buffer.from(`lydoc-admin-mfa:v1:${input.userId}:${input.keyId}`, "utf8"),
  );
  const ciphertext = Buffer.concat([
    cipher.update(input.secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    input.keyId,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function provisioningUri(email, secret) {
  const uri = new URL(`otpauth://totp/${encodeURIComponent(`Lydoc:${email}`)}`);
  uri.searchParams.set("secret", secret);
  uri.searchParams.set("issuer", "Lydoc");
  uri.searchParams.set("algorithm", "SHA1");
  uri.searchParams.set("digits", "6");
  uri.searchParams.set("period", "30");
  return uri.toString();
}

function encodeBase32(value) {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += base32Alphabet[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) output += base32Alphabet[(accumulator << (5 - bits)) & 31];
  return output;
}

function normalizeEmail(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("--email must contain a valid e-mail address.");
  }
  return email;
}

function requireKeyId(value) {
  const keyId = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(keyId)) {
    throw new Error("MFA_ENCRYPTION_KEY_ID is required and invalid.");
  }
  return keyId;
}

function requireDedicatedSecret(value) {
  const secret = String(value ?? "");
  if (
    secret.length < 32 ||
    /change[_-]?me|replace-with/i.test(secret) ||
    secret === process.env.SESSION_SECRET ||
    secret === process.env.DOCUMENT_ENCRYPTION_SECRET ||
    secret === process.env.BACKUP_ENCRYPTION_SECRET
  ) {
    throw new Error("MFA_ENCRYPTION_SECRET must be a dedicated secret.");
  }
  return secret;
}

function parseArguments(argv) {
  let email;
  let environmentFile = ".env";
  let rotate = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--email") email = argv[++index];
    else if (argument === "--env-file") environmentFile = argv[++index];
    else if (argument === "--rotate") rotate = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!email) throw new Error("Usage: --email user@example.com [--rotate].");
  return { email, environmentFile, rotate };
}

function loadEnvironmentFile(path) {
  const absolutePath = resolve(process.cwd(), path);
  if (!existsSync(absolutePath)) return;
  for (const line of readFileSync(absolutePath, "utf8").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match?.[1] || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = (match[2] ?? "").replace(
      /^(?:"(.*)"|'(.*)')$/,
      "$1$2",
    );
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  loadEnvironmentFile(options.environmentFile);
  const result = await provisionAdmin(options);
  process.stdout.write(
    [
      result.rotated
        ? "Administrator MFA rotated successfully."
        : "Administrator provisioned successfully.",
      "Store this secret now; it will not be shown again.",
      `Email: ${result.email}`,
      `Secret: ${result.secret}`,
      `URI: ${result.provisioningUri}`,
      "All previous sessions have been revoked.",
    ].join("\n") + "\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `Administrator provisioning failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
