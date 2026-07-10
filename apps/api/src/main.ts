import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // A 20 MiB file becomes about 26.7 MiB once encoded as base64 in JSON.
  app.use(json({ limit: "30mb" }));
  app.enableCors({
    origin: buildCorsOrigins(),
    credentials: true,
  });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}

void bootstrap();

function buildCorsOrigins(): Array<string | RegExp> {
  if (!process.env.APP_URL) {
    return [/^http:\/\/localhost:\d+$/];
  }

  return process.env.APP_URL.split(",").map((origin) => origin.trim());
}
