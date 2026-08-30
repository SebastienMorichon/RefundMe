import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PasswordHasher } from "@lydoc/application";

const scrypt = promisify(scryptCallback);
const dummyPasswordHash =
  "scrypt:lydoc-auth-dummy-v1:QsITvUQTazIvvnFRKD7-NYePJ46_RmZ4RhJaJvoNhXXP7AEoU28WHZoa19uPq_o0KRTNAvM4t7A6pf4zAHtwFg";
let activeScryptOperations = 0;
const pendingScryptOperations: Array<() => void> = [];

@Injectable()
export class NodePasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const derivedKey = await runBoundedScrypt(password, salt);

    return `scrypt:${salt}:${derivedKey.toString("base64url")}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const [algorithm, salt, storedKey] = hash.split(":");

    if (algorithm !== "scrypt" || !salt || !storedKey) {
      return false;
    }

    const candidateKey = await runBoundedScrypt(password, salt);
    const storedKeyBuffer = Buffer.from(storedKey, "base64url");

    return (
      candidateKey.length === storedKeyBuffer.length &&
      timingSafeEqual(candidateKey, storedKeyBuffer)
    );
  }

  async verifyWithDummy(
    password: string,
    passwordHash: string | undefined,
  ): Promise<boolean> {
    return this.verify(
      password,
      passwordHash?.startsWith("scrypt:")
        ? passwordHash
        : dummyPasswordHash,
    );
  }

  createUnusableHash(): string {
    return `pending:${randomBytes(32).toString("base64url")}`;
  }
}

async function runBoundedScrypt(password: string, salt: string): Promise<Buffer> {
  await acquireScryptSlot();
  try {
    return (await scrypt(password, salt, 64)) as Buffer;
  } finally {
    releaseScryptSlot();
  }
}

function acquireScryptSlot(): Promise<void> {
  const concurrency = readBoundedInteger("AUTH_SCRYPT_CONCURRENCY", 2, 8);
  const queueLimit = readBoundedInteger("AUTH_SCRYPT_QUEUE_LIMIT", 8, 100);
  if (activeScryptOperations < concurrency) {
    activeScryptOperations += 1;
    return Promise.resolve();
  }
  if (pendingScryptOperations.length >= queueLimit) {
    throw new HttpException(
      "Service d'authentification momentanement sature.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  return new Promise((resolve) => pendingScryptOperations.push(resolve));
}

function releaseScryptSlot(): void {
  activeScryptOperations = Math.max(0, activeScryptOperations - 1);
  const next = pendingScryptOperations.shift();
  if (next) {
    activeScryptOperations += 1;
    next();
  }
}

function readBoundedInteger(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 && value <= maximum
    ? value
    : fallback;
}
