import "reflect-metadata";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { readApiRuntimeConfig } from "@lydoc/config";
import { AppModule } from "./app.module";
import { applySecurityHeaders, createRateLimiter } from "./platform/http-protection";

async function bootstrap() {
  loadEnvironmentFile();
  const config = readApiRuntimeConfig(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set("trust proxy", config.trustProxy);
  // A 20 MiB file becomes about 26.7 MiB once encoded as base64 in JSON.
  app.use(json({ limit: "30mb" }));
  app.use(applySecurityHeaders);
  app.use(createRateLimiter());
  app.enableCors({
    origin: config.appOrigins,
    credentials: true,
  });

  await app.listen(config.port);
}

void bootstrap();

function loadEnvironmentFile(): void {
  const path = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")].find(
    existsSync,
  );
  if (!path) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match?.[1] || process.env[match[1]] !== undefined) {
      continue;
    }

    const value = match[2] ?? "";
    process.env[match[1]] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
}
