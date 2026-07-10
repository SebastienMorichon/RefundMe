import { Injectable } from "@nestjs/common";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PasswordHasher } from "@lydoc/application";

const scrypt = promisify(scryptCallback);

@Injectable()
export class NodePasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

    return `scrypt:${salt}:${derivedKey.toString("base64url")}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const [algorithm, salt, storedKey] = hash.split(":");

    if (algorithm !== "scrypt" || !salt || !storedKey) {
      return false;
    }

    const candidateKey = (await scrypt(password, salt, 64)) as Buffer;
    const storedKeyBuffer = Buffer.from(storedKey, "base64url");

    return (
      candidateKey.length === storedKeyBuffer.length &&
      timingSafeEqual(candidateKey, storedKeyBuffer)
    );
  }
}

