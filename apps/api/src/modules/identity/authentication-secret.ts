export function readAuthenticationSecret(): string {
  const localDefault = "local-dev-session-secret-change-me";
  const configuredSecret = process.env.SESSION_SECRET;

  if (
    process.env.NODE_ENV === "production" &&
    (!configuredSecret ||
      configuredSecret === localDefault ||
      configuredSecret.includes("replace-with") ||
      configuredSecret.includes("change-me") ||
      configuredSecret.length < 32)
  ) {
    throw new Error("SESSION_SECRET must be configured in production.");
  }

  return configuredSecret ?? localDefault;
}
