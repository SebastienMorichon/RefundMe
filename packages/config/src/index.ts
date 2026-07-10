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

