import { ServiceUnavailableException } from "@nestjs/common";

export const managedPostalUnavailableMessage =
  "L'envoi postal pris en charge sera bientôt disponible. Téléchargez gratuitement votre dossier pour l'envoyer vous-même.";

export function isManagedPostalEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.MANAGED_POSTAL_ENABLED?.trim().toLowerCase() === "true";
}

export function isSensitiveDocumentWatermarkingEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.NODE_ENV === "production";
}

export function requireManagedPostalEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (!isManagedPostalEnabled(environment)) {
    throw new ServiceUnavailableException(managedPostalUnavailableMessage);
  }
}
