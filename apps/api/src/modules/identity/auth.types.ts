import type { Request } from "express";
import type { SessionUser } from "./session.service";

export type AuthenticatedRequest = Request & {
  user?: SessionUser;
};

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  const cookies = header.split(";").map((cookie) => cookie.trim());
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

