import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const protectedRoutePatterns = [/^\/auth\/(login|register)$/, /^\/documents/];

export function applySecurityHeaders(request: Request, response: Response, next: NextFunction): void {
  const requestId = request.header("x-request-id") ?? randomUUID();

  response.setHeader("X-Request-Id", requestId);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (process.env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

export function createRateLimiter(limit = 20, windowMs = 60_000) {
  const attempts = new Map<string, RateLimitEntry>();

  return (request: Request, response: Response, next: NextFunction): void => {
    if (!protectedRoutePatterns.some((pattern) => pattern.test(request.path))) {
      next();
      return;
    }

    const now = Date.now();
    if (attempts.size >= 10_000) {
      for (const [attemptKey, attempt] of attempts) {
        if (attempt.resetAt <= now) {
          attempts.delete(attemptKey);
        }
      }

      if (attempts.size >= 10_000) {
        const firstKey = attempts.keys().next().value;
        if (firstKey) {
          attempts.delete(firstKey);
        }
      }
    }

    const key = `${request.ip}:${request.path}`;
    const current = attempts.get(key);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;

    entry.count += 1;
    attempts.set(key, entry);
    response.setHeader("RateLimit-Limit", limit);
    response.setHeader("RateLimit-Remaining", Math.max(0, limit - entry.count));
    response.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > limit) {
      response.status(429).json({
        statusCode: 429,
        message: "Trop de requetes. Reessayez dans une minute.",
      });
      return;
    }

    next();
  };
}
