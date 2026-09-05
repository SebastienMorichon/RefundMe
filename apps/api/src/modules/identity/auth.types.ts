import type { Request } from "express";
import type { AuthenticatedSession, SessionUser } from "./session.service";

export type AuthenticatedRequest = Request & {
  user?: SessionUser;
  session?: AuthenticatedSession;
};

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  const cookies = header.split(";").map((cookie) => cookie.trim());
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));

  if (!cookie) {
    return undefined;
  }

  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return undefined;
  }
}
