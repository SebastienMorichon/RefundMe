export type AppConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  appUrl: string;
  apiUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
  };
}>;

export type ApiRuntimeConfig = Readonly<{
  nodeEnv: AppConfig["nodeEnv"];
  port: number;
  appOrigins: string[];
  trustProxy: boolean;
}>;

export function readConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    appUrl: required(env.APP_URL, "APP_URL"),
    apiUrl: required(env.API_URL, "API_URL"),
    databaseUrl: required(env.DATABASE_URL, "DATABASE_URL"),
    s3: {
      endpoint: required(env.S3_ENDPOINT, "S3_ENDPOINT"),
      region: required(env.S3_REGION, "S3_REGION"),
      bucket: required(env.S3_BUCKET, "S3_BUCKET"),
    },
  };
}

export function readApiRuntimeConfig(env: NodeJS.ProcessEnv): ApiRuntimeConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const appUrl = env.APP_URL?.trim();

  if (nodeEnv === "production" && !appUrl) {
    throw new Error("Missing environment variable: APP_URL");
  }

  return {
    nodeEnv,
    port: parsePort(env.PORT),
    appOrigins: (appUrl ?? "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === "true",
  };
}

function parseNodeEnv(value: string | undefined): AppConfig["nodeEnv"] {
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }

  return "development";
}

function required(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }

  return value;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3001;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}
