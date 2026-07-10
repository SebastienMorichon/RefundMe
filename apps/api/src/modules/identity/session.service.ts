import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

const sessionCookieName = "lydoc_session";
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;

export type SessionUser = Readonly<{
  id: string;
  email: string;
  role: string;
}>;

type SessionPayload = SessionUser & Readonly<{ expiresAt: number }>;

@Injectable()
export class SessionService {
  private readonly secret = readSessionSecret();

  get cookieName(): string {
    return sessionCookieName;
  }

  get maxAgeSeconds(): number {
    return sessionLifetimeSeconds;
  }

  createCookieValue(user: SessionUser): string {
    const session: SessionPayload = {
      ...user,
      expiresAt: Date.now() + sessionLifetimeSeconds * 1000,
    };
    const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
    const signature = this.sign(payload);

    return `${payload}.${signature}`;
  }

  readCookieValue(value: string | undefined): SessionUser | null {
    if (!value) {
      return null;
    }

    const [payload, signature] = value.split(".");

    if (!payload || !signature || !this.verify(payload, signature)) {
      return null;
    }

    try {
      const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;

      if (
        typeof session.id !== "string" ||
        typeof session.email !== "string" ||
        typeof session.role !== "string" ||
        typeof session.expiresAt !== "number" ||
        session.expiresAt <= Date.now()
      ) {
        return null;
      }

      return { id: session.id, email: session.email, role: session.role };
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  private verify(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);

    return expected.length === received.length && timingSafeEqual(expected, received);
  }
}

function readSessionSecret(): string {
  const localDefault = "local-dev-session-secret-change-me";
  const configuredSecret = process.env.SESSION_SECRET;

  if (process.env.NODE_ENV === "production" && (!configuredSecret || configuredSecret === localDefault)) {
    throw new Error("SESSION_SECRET must be configured in production.");
  }

  return configuredSecret ?? localDefault;
}
