import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  json,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const maximumRateLimitEntries = 10_000;
const maximumRateLimitPruneScan = 128;
const defaultGeneralRateLimitPerMinute = 120;
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const csrfExemptPaths = new Set([
  "/payments/sumup/webhook",
  "/shipping/service-postal/webhook",
]);
const signedWebhookPaths = new Set(["/shipping/service-postal/webhook"]);

type CsrfProtectionOptions = Readonly<{
  cookieName: string;
  validateToken: (
    cookieValue: string | undefined,
    headerValue: string | undefined,
  ) => boolean;
}>;

export function applySecurityHeaders(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const receivedRequestId = request.header("x-request-id");
  const requestId =
    receivedRequestId && /^[A-Za-z0-9._-]{8,80}$/.test(receivedRequestId)
      ? receivedRequestId
      : randomUUID();
  const startedAt = performance.now();

  response.setHeader("X-Request-Id", requestId);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Pragma", "no-cache");
  response.vary("Cookie");
  response.vary("Origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (process.env.NODE_ENV === "production") {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  response.on("finish", () => {
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.LOG_HTTP !== "true"
    )
      return;
    process.stdout.write(
      `${JSON.stringify({
        level:
          response.statusCode >= 500
            ? "error"
            : response.statusCode >= 400
              ? "warn"
              : "info",
        type: "http_request",
        requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
        timestamp: new Date().toISOString(),
      })}\n`,
    );
  });

  next();
}

/** All non-document JSON requests, including webhooks, are capped at 1 MiB. */
export function createDefaultJsonBodyParser(): RequestHandler {
  return createJsonBodyParser("1mb", true);
}

/** Bounds multipart uploads before their stream reaches Multer/CDR. */
export function createUploadConcurrencyLimiter(
  globalLimit = 4,
  perClientLimit = 2,
) {
  let activeGlobal = 0;
  const activeByClient = new Map<string, number>();

  return (request: Request, response: Response, next: NextFunction): void => {
    if (
      request.method.toUpperCase() !== "POST" ||
      normalizeRequestPath(request.path) !== "/documents"
    ) {
      next();
      return;
    }
    const client = request.ip || request.socket.remoteAddress || "unknown";
    const activeClient = activeByClient.get(client) ?? 0;
    if (activeGlobal >= globalLimit || activeClient >= perClientLimit) {
      response.setHeader("Retry-After", "5");
      response.status(429).json({
        statusCode: 429,
        message: "Trop de depots simultanes. Reessayez dans quelques instants.",
      });
      return;
    }

    activeGlobal += 1;
    activeByClient.set(client, activeClient + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeGlobal = Math.max(0, activeGlobal - 1);
      const remaining = (activeByClient.get(client) ?? 1) - 1;
      if (remaining <= 0) activeByClient.delete(client);
      else activeByClient.set(client, remaining);
    };
    response.once("finish", release);
    response.once("close", release);
    next();
  };
}

/** General IP limiter. Register this before every route-specific limiter. */
export function createGeneralRateLimiter(
  limit = readGeneralRateLimitPerMinute(),
  windowMs = 60_000,
  now: () => number = Date.now,
) {
  const attempts = new Map<string, RateLimitEntry>();

  return (request: Request, response: Response, next: NextFunction): void => {
    const path = normalizeRequestPath(request.path);
    if (path === "/health/live" || path === "/health/ready") {
      next();
      return;
    }

    const ip = request.ip || request.socket.remoteAddress || "unknown";
    consumeRateLimit({
      attempts,
      key: ip,
      limit,
      windowMs,
      now: now(),
      response,
      next,
    });
  };
}

export function readGeneralRateLimitPerMinute(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const raw = environment.API_GENERAL_RATE_LIMIT_PER_MINUTE?.trim();
  if (!raw && environment.NODE_ENV !== "production") {
    return defaultGeneralRateLimitPerMinute;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 10_000) {
    throw new Error(
      "API_GENERAL_RATE_LIMIT_PER_MINUTE must be an integer between 10 and 10000.",
    );
  }
  return parsed;
}

/** Sensitive-route IP limiter. Register this before body parsing. */
export function createRateLimiter(
  limit = 10,
  windowMs = 60_000,
  now: () => number = Date.now,
) {
  const attempts = new Map<string, RateLimitEntry>();

  return (request: Request, response: Response, next: NextFunction): void => {
    const path = normalizeRequestPath(request.path);
    if (!isIpRateLimitedPath(path)) {
      next();
      return;
    }

    const ip = request.ip || request.socket.remoteAddress || "unknown";
    consumeRateLimit({
      attempts,
      key: `${ip}:${rateLimitBucketPath(path)}`,
      limit,
      windowMs,
      now: now(),
      response,
      next,
    });
  };
}

/** E-mail limiter. Register this after JSON body parsing. */
export function createIdentifierRateLimiter(
  limit = 20,
  windowMs = 15 * 60_000,
  now: () => number = Date.now,
) {
  const attempts = new Map<string, RateLimitEntry>();

  return (request: Request, response: Response, next: NextFunction): void => {
    const path = normalizeRequestPath(request.path);
    if (
      path !== "/auth/login" &&
      path !== "/auth/register" &&
      path !== "/auth/resend-verification" &&
      path !== "/auth/forgot-password"
    ) {
      next();
      return;
    }

    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    if (typeof body.email !== "string" || body.email.length > 254) {
      next();
      return;
    }
    const identifier = body.email.trim().toLowerCase();
    if (!identifier) {
      next();
      return;
    }

    const identifierHash = createHash("sha256")
      .update(identifier)
      .digest("base64url");
    consumeRateLimit({
      attempts,
      key: `${path}:${identifierHash}`,
      limit,
      windowMs,
      now: now(),
      response,
      next,
    });
  };
}

export function createCsrfProtection(
  allowedOrigins: string[],
  options: CsrfProtectionOptions,
) {
  const allowed = new Set(allowedOrigins.map(readOrigin));
  if (allowed.size === 0) {
    throw new Error("At least one trusted application origin is required.");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.cookieName)) {
    throw new Error("Invalid CSRF cookie name.");
  }

  return (request: Request, response: Response, next: NextFunction): void => {
    const path = normalizeRequestPath(request.path);
    if (
      safeMethods.has(request.method.toUpperCase()) ||
      csrfExemptPaths.has(path)
    ) {
      next();
      return;
    }

    if (request.header("sec-fetch-site")?.toLowerCase() === "cross-site") {
      rejectCsrf(response);
      return;
    }

    const source = request.header("origin") ?? request.header("referer");
    const sourceOrigin = source ? tryReadOrigin(source) : null;
    if (!sourceOrigin || !allowed.has(sourceOrigin)) {
      rejectCsrf(response);
      return;
    }

    const cookieValue = readSingleCookie(
      request.headers.cookie,
      options.cookieName,
    );
    const headerValue = request.header("x-csrf-token");
    if (!options.validateToken(cookieValue, headerValue)) {
      rejectCsrf(response);
      return;
    }

    next();
  };
}

export function normalizeRequestPath(value: string): string {
  const withoutQuery = value.split("?", 1)[0] ?? "/";
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // Keep the encoded value; malformed paths will not match protected routes.
  }
  const normalized = decoded
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  return normalized || "/";
}

export function parseTrustedProxyCidrs(
  trustProxy: boolean,
  configuredCidrs: string | undefined,
  requireExactHosts = process.env.NODE_ENV === "production",
): false | string[] {
  if (!trustProxy) {
    if (requireExactHosts) {
      throw new Error("TRUST_PROXY must be enabled in production.");
    }
    return false;
  }

  const cidrs = (configuredCidrs ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (cidrs.length === 0 || cidrs.length > 16) {
    throw new Error(
      "TRUST_PROXY_CIDRS must list between 1 and 16 trusted proxy IPs or CIDRs.",
    );
  }
  for (const cidr of cidrs) {
    if (
      !isBoundedIpOrCidr(cidr) ||
      (requireExactHosts && !isExactProxyHost(cidr))
    ) {
      throw new Error(`Invalid or unbounded trusted proxy CIDR: ${cidr}`);
    }
  }
  return cidrs;
}

export function isIpRateLimitedPath(path: string): boolean {
  return (
    path === "/auth/login" ||
    path === "/auth/register" ||
    path === "/auth/resend-verification" ||
    path === "/auth/verify-email" ||
    path === "/auth/forgot-password" ||
    path === "/auth/reset-password" ||
    path === "/auth/change-password" ||
    path === "/auth/mfa/verify" ||
    path === "/auth/account/export" ||
    path === "/auth/account/delete" ||
    path === "/contact" ||
    path === "/documents" ||
    path.startsWith("/documents/") ||
    isPacketDownloadPath(path)
  );
}

function isPacketDownloadPath(path: string): boolean {
  return /^\/cases\/[^/]{1,128}\/dossier\.pdf$/.test(path);
}

/** Canonicalizes variable identifiers so changing an ID cannot evade a limit. */
export function rateLimitBucketPath(path: string): string {
  if (isPacketDownloadPath(path)) return "/cases/:id/dossier.pdf";
  if (/^\/documents\/[^/]+\/case$/.test(path)) {
    return "/documents/:id/case";
  }
  if (/^\/documents\/[^/]+$/.test(path)) return "/documents/:id";
  return path;
}

function createJsonBodyParser(
  limit: string,
  captureSignedWebhookBody = false,
): RequestHandler {
  return json({
    limit,
    verify(request, _response, buffer) {
      if (
        captureSignedWebhookBody &&
        signedWebhookPaths.has(normalizeRequestPath((request as Request).path))
      ) {
        (request as Request & { rawBody?: Buffer }).rawBody =
          Buffer.from(buffer);
      }
    },
  });
}

function consumeRateLimit(input: {
  attempts: Map<string, RateLimitEntry>;
  key: string;
  limit: number;
  windowMs: number;
  now: number;
  response: Response;
  next: NextFunction;
}): void {
  let current = input.attempts.get(input.key);
  if (!current) {
    pruneRateLimits(input.attempts, input.now);
    current = input.attempts.get(input.key);
  }
  const entry =
    !current || current.resetAt <= input.now
      ? { count: 0, resetAt: input.now + input.windowMs }
      : current;

  entry.count += 1;
  input.attempts.set(input.key, entry);
  const remaining = Math.max(0, input.limit - entry.count);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((entry.resetAt - input.now) / 1000),
  );
  input.response.setHeader("RateLimit-Limit", input.limit);
  input.response.setHeader("RateLimit-Remaining", remaining);
  input.response.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

  if (entry.count > input.limit) {
    input.response.setHeader("Retry-After", retryAfterSeconds);
    input.response.status(429).json({
      statusCode: 429,
      message: "Trop de requetes. Reessayez plus tard.",
    });
    return;
  }
  input.next();
}

function pruneRateLimits(
  attempts: Map<string, RateLimitEntry>,
  now: number,
): void {
  if (attempts.size < maximumRateLimitEntries) return;
  let inspected = 0;
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
    inspected += 1;
    if (
      attempts.size < maximumRateLimitEntries ||
      inspected >= maximumRateLimitPruneScan
    ) {
      break;
    }
  }
  while (attempts.size >= maximumRateLimitEntries) {
    const firstKey = attempts.keys().next().value as string | undefined;
    if (!firstKey) break;
    attempts.delete(firstKey);
  }
}

function rejectCsrf(response: Response): void {
  response.status(403).json({
    statusCode: 403,
    code: "CSRF_INVALID",
    message: "Verification CSRF impossible.",
  });
}

function readSingleCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header || header.length > 8_192) return undefined;
  let value: string | undefined;
  let found = false;
  for (const segment of header.split(";")) {
    const cookie = segment.trim();
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator) !== name) continue;
    if (found) return undefined;
    found = true;
    try {
      value = decodeURIComponent(cookie.slice(separator + 1));
    } catch {
      return undefined;
    }
  }
  return value;
}

function readOrigin(value: string): string {
  const origin = tryReadOrigin(value);
  if (!origin) throw new Error(`Invalid application origin: ${value}`);
  return origin;
}

function tryReadOrigin(value: string): string | null {
  if (!value || value.length > 2_048 || value === "null") return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isBoundedIpOrCidr(value: string): boolean {
  const parts = value.split("/");
  if (parts.length > 2) return false;
  const address = parts[0] ?? "";
  const version = isIP(address);
  if (!version) return false;
  if (parts.length === 1) return true;
  const prefix = Number(parts[1]);
  const maximum = version === 4 ? 32 : 128;
  return Number.isInteger(prefix) && prefix >= 1 && prefix <= maximum;
}

function isExactProxyHost(value: string): boolean {
  const [address = "", prefix, ...extra] = value.split("/");
  if (extra.length > 0) return false;
  const version = isIP(address);
  if (!version || isUnusableProxyAddress(address)) return false;
  if (prefix === undefined) return true;
  return Number(prefix) === (version === 4 ? 32 : 128);
}

function isUnusableProxyAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const firstIpv4Octet = normalized.includes(".")
    ? Number(normalized.split(".", 1)[0])
    : Number.NaN;
  return (
    normalized === "0.0.0.0" ||
    normalized === "255.255.255.255" ||
    normalized === "::" ||
    normalized === "0:0:0:0:0:0:0:0" ||
    (firstIpv4Octet >= 224 && firstIpv4Octet <= 239) ||
    normalized.startsWith("ff")
  );
}
