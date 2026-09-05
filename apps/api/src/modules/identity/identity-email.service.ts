import { Injectable } from "@nestjs/common";
import { IdentityTokenPurpose } from "@prisma/client";

export type IdentityEmailInput = Readonly<{
  email: string;
  purpose: IdentityTokenPurpose;
  rawToken: string;
  tokenId: string;
  expiresAt: Date;
}>;

type IdentityEmailConfiguration = Readonly<{
  apiKey: string;
  from: string;
  applicationUrl: URL;
}>;

export class IdentityEmailDeliveryError extends Error {
  constructor(
    readonly failureCode: string,
    readonly retryable: boolean,
  ) {
    super("Identity email delivery failed");
    this.name = "IdentityEmailDeliveryError";
  }
}

@Injectable()
export class IdentityEmailService {
  private readonly configuration = readConfiguration();

  async send(input: IdentityEmailInput): Promise<string | null> {
    if (!this.configuration) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Identity email delivery is not configured.");
      }
      return null;
    }

    const template = emailTemplate(input.purpose);
    const actionUrl = new URL(template.path, this.configuration.applicationUrl);
    actionUrl.hash = new URLSearchParams({ token: input.rawToken }).toString();
    const actionUrlString = actionUrl.toString();
    const idempotencyKey = `lydoc-${input.purpose.toLowerCase()}-${input.tokenId}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.configuration.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: this.configuration.from,
        to: [input.email],
        subject: template.subject,
        text: `${template.message}\n\n${actionUrlString}\n\nCe lien expire le ${input.expiresAt.toISOString()}.`,
        html: renderIdentityEmail({
          actionUrl: actionUrlString,
          actionLabel: template.actionLabel,
          expiresAt: input.expiresAt,
          message: template.message,
          subject: template.subject,
        }),
        tags: [
          { name: "event", value: input.purpose.toLowerCase() },
          { name: "token", value: input.tokenId.slice(0, 64) },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await readBoundedJson(response, 16 * 1_024);
    if (!response.ok) {
      throw new IdentityEmailDeliveryError(
        `PROVIDER_HTTP_${boundedStatus(response.status)}`,
        isRetryableStatus(response.status),
      );
    }
    if (typeof payload.id !== "string" || payload.id.length > 128) {
      throw new IdentityEmailDeliveryError("PROVIDER_INVALID_RESPONSE", true);
    }
    return payload.id;
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new IdentityEmailDeliveryError("PROVIDER_RESPONSE_TOO_LARGE", true);
  }
  if (!response.body) return {};

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new IdentityEmailDeliveryError(
          "PROVIDER_RESPONSE_TOO_LARGE",
          true,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const text = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
    ).toString("utf8");
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (error) {
    if (error instanceof IdentityEmailDeliveryError) throw error;
    throw new IdentityEmailDeliveryError("PROVIDER_INVALID_RESPONSE", true);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function boundedStatus(status: number): string {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? String(status)
    : "UNKNOWN";
}

function readConfiguration(): IdentityEmailConfiguration | null {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.RESEND_FROM_EMAIL?.trim() ?? "";
  const production = process.env.NODE_ENV === "production";
  if (!apiKey.startsWith("re_") || apiKey.includes("change_me") || !from) {
    return null;
  }

  const rawApplicationUrl =
    process.env.APP_URL?.split(",")[0]?.trim() ?? "http://localhost:3000";
  let applicationUrl: URL;
  try {
    applicationUrl = new URL(rawApplicationUrl);
  } catch {
    throw new Error("APP_URL must contain a valid application origin.");
  }
  if (
    (applicationUrl.protocol !== "http:" &&
      applicationUrl.protocol !== "https:") ||
    applicationUrl.username ||
    applicationUrl.password ||
    (production && applicationUrl.protocol !== "https:")
  ) {
    throw new Error(
      "APP_URL must contain a trusted HTTPS origin in production.",
    );
  }
  return { apiKey, from, applicationUrl };
}

function emailTemplate(purpose: IdentityTokenPurpose) {
  if (purpose === IdentityTokenPurpose.EMAIL_VERIFICATION) {
    return {
      subject: "Confirmez votre adresse e-mail Lydoc",
      message:
        "Confirmez votre adresse e-mail pour activer votre compte Lydoc.",
      actionLabel: "Confirmer mon adresse",
      path: "/verification-email",
    };
  }
  return {
    subject: "Reinitialisez votre mot de passe Lydoc",
    message:
      "Une demande de reinitialisation de votre mot de passe Lydoc a ete recue.",
    actionLabel: "Reinitialiser mon mot de passe",
    path: "/reinitialisation-mot-de-passe",
  };
}

function renderIdentityEmail(input: {
  actionUrl: string;
  actionLabel: string;
  expiresAt: Date;
  message: string;
  subject: string;
}): string {
  return `<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;color:#17233c"><h1>${escapeHtml(input.subject)}</h1><p>${escapeHtml(input.message)}</p><p><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:12px 18px;background:#244fda;color:#fff;text-decoration:none;border-radius:8px">${escapeHtml(input.actionLabel)}</a></p><p>Ce lien expire le ${escapeHtml(input.expiresAt.toISOString())}.</p><p>Si vous n'etes pas a l'origine de cette demande, ignorez cet e-mail.</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
