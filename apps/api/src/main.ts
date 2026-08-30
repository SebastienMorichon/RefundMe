import "reflect-metadata";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { readApiRuntimeConfig } from "@lydoc/config";
import { AppModule } from "./app.module";
import { SessionService } from "./modules/identity/session.service";
import {
  applySecurityHeaders,
  createCsrfProtection,
  createDefaultJsonBodyParser,
  createGeneralRateLimiter,
  createIdentifierRateLimiter,
  createRateLimiter,
  parseTrustedProxyCidrs,
  readGeneralRateLimitPerMinute,
} from "./platform/http-protection";

async function bootstrap() {
  loadEnvironmentFile();
  const config = readApiRuntimeConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
  const sessions = app.get(SessionService);
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .set(
      "trust proxy",
      parseTrustedProxyCidrs(
        config.trustProxy,
        process.env.TRUST_PROXY_CIDRS,
        process.env.NODE_ENV === "production",
      ),
    );
  app.use(applySecurityHeaders);
  app.use(createGeneralRateLimiter(readGeneralRateLimitPerMinute(process.env)));
  app.use(createRateLimiter());
  app.use(
    createCsrfProtection(config.appOrigins, {
      cookieName: sessions.csrfCookieName,
      validateToken: (cookieValue, headerValue) =>
        sessions.validateCsrfToken(cookieValue, headerValue),
    }),
  );
  app.use(createDefaultJsonBodyParser());
  app.use(createIdentifierRateLimiter());
  app.enableCors({
    origin: config.appOrigins,
    credentials: true,
  });

  const server = app.getHttpServer() as Server;
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;

  await app.listen(config.port);
}

void bootstrap();

function loadEnvironmentFile(): void {
  const path = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ].find(existsSync);
  if (!path) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match?.[1] || process.env[match[1]] !== undefined) {
      continue;
    }

    const value = match[2] ?? "";
    process.env[match[1]] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
}
