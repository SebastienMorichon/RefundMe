import { Injectable } from "@nestjs/common";
import { NotificationDeliveryStatus } from "@prisma/client";
import { isManagedPostalEnabled } from "../../platform/feature-flags";
import { PrismaService } from "../prisma/prisma.service";

type NotificationTemplate = Readonly<{
  subject: string;
  heading: string;
  message: string;
  actionLabel: string;
}>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async sendCaseEvent(caseId: string, eventType: string): Promise<void> {
    const administrativeCase = await this.prisma.administrativeCase.findUnique({
      where: { id: caseId },
      include: {
        owner: { select: { id: true, email: true, firstName: true } },
        gameRule: { select: { name: true } },
      },
    });
    if (!administrativeCase) return;
    const template = notificationTemplate(
      eventType,
      administrativeCase.gameRule?.name ?? "votre dossier",
    );
    if (!template) return;

    const eventKey = `${eventType}:${caseId}`.slice(0, 256);
    const existing = await this.prisma.notificationDelivery.findUnique({
      where: { eventKey },
    });
    if (existing?.status === NotificationDeliveryStatus.SENT) return;

    const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
    const from = process.env.RESEND_FROM_EMAIL?.trim() ?? "";
    if (!apiKey.startsWith("re_") || apiKey.includes("change_me") || !from) {
      await this.persistSkipped({
        caseId,
        userId: administrativeCase.owner.id,
        recipient: administrativeCase.owner.email,
        eventType,
        eventKey,
        reason: !from
          ? "RESEND_FROM_EMAIL_NOT_CONFIGURED"
          : "RESEND_API_KEY_NOT_CONFIGURED",
      });
      return;
    }

    const delivery = await this.prisma.notificationDelivery.upsert({
      where: { eventKey },
      create: {
        userId: administrativeCase.owner.id,
        caseId,
        eventType,
        eventKey,
        recipient: administrativeCase.owner.email,
        status: NotificationDeliveryStatus.PENDING,
        provider: "resend",
        attempts: 1,
      },
      update: {
        status: NotificationDeliveryStatus.PENDING,
        provider: "resend",
        attempts: { increment: 1 },
        errorMessage: null,
      },
    });

    try {
      const caseUrl = `${applicationUrl()}/cases/${caseId}`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": eventKey,
        },
        body: JSON.stringify({
          from,
          to: [administrativeCase.owner.email],
          subject: template.subject,
          text: `${template.heading}\n\n${template.message}\n\n${template.actionLabel}: ${caseUrl}`,
          html: renderEmailHtml({
            firstName: administrativeCase.owner.firstName,
            template,
            caseUrl,
          }),
          tags: [
            { name: "event", value: safeTag(eventType) },
            { name: "case", value: safeTag(caseId) },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok || typeof payload.id !== "string") {
        throw new Error(readProviderError(payload, response.status));
      }
      await this.prisma.$transaction([
        this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: NotificationDeliveryStatus.SENT,
            providerMessageId: payload.id,
            sentAt: new Date(),
            errorMessage: null,
          },
        }),
        this.prisma.auditLog.create({
          data: {
            actorId: administrativeCase.owner.id,
            action: "CASE_NOTIFICATION_SENT",
            entityType: "AdministrativeCase",
            entityId: caseId,
            metadata: { eventType, provider: "resend" },
          },
        }),
      ]);
    } catch (error) {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.FAILED,
          errorMessage: safeNotificationError(error),
        },
      });
    }
  }

  async listForUser(userId: string) {
    return this.prisma.notificationDelivery.findMany({
      where: { userId },
      select: {
        id: true,
        caseId: true,
        eventType: true,
        status: true,
        sentAt: true,
        readAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markRead(notificationId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    return result.count > 0;
  }

  private async persistSkipped(input: {
    userId: string;
    caseId: string;
    eventType: string;
    eventKey: string;
    recipient: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.notificationDelivery.upsert({
      where: { eventKey: input.eventKey },
      create: {
        userId: input.userId,
        caseId: input.caseId,
        eventType: input.eventType,
        eventKey: input.eventKey,
        recipient: input.recipient,
        status: NotificationDeliveryStatus.SKIPPED,
        provider: "disabled",
        errorMessage: input.reason,
      },
      update: {
        status: NotificationDeliveryStatus.SKIPPED,
        provider: "disabled",
        errorMessage: input.reason,
      },
    });
  }
}

function notificationTemplate(
  eventType: string,
  caseName: string,
): NotificationTemplate | null {
  const templates: Record<string, NotificationTemplate> = {
    CASE_VALIDATED: {
      subject: "Votre dossier Lydoc est validé",
      heading: "Votre dossier est complet",
      message: isManagedPostalEnabled()
        ? `Les pièces du dossier « ${caseName} » sont réunies. Vous pouvez maintenant choisir le téléchargement gratuit ou l’envoi pris en charge.`
        : `Les pièces du dossier « ${caseName} » sont réunies. Vous pouvez maintenant télécharger gratuitement le dossier complet.`,
      actionLabel: isManagedPostalEnabled()
        ? "Choisir mon mode d’envoi"
        : "Télécharger mon dossier",
    },
    PAYMENT_CONFIRMED: {
      subject: "Paiement confirmé pour votre envoi",
      heading: "Votre paiement est confirmé",
      message: `L’impression et l’envoi du dossier « ${caseName} » vont être lancés.`,
      actionLabel: "Suivre mon dossier",
    },
    POSTAL_SUBMITTED: {
      subject: "Votre courrier a été transmis",
      heading: "Votre courrier est en préparation",
      message: `Le dossier « ${caseName} » a été transmis au prestataire postal.`,
      actionLabel: "Voir le suivi",
    },
    POSTAL_DELIVERED: {
      subject: "Votre courrier a été distribué",
      heading: "Votre courrier est arrivé",
      message: `Le dossier « ${caseName} » a été distribué à l’organisateur.`,
      actionLabel: "Voir mon dossier",
    },
    REFUND_CONFIRMED: {
      subject: "Remboursement enregistré",
      heading: "Votre remboursement est confirmé",
      message: `Le dossier « ${caseName} » est maintenant terminé.`,
      actionLabel: "Voir le récapitulatif",
    },
  };
  return templates[eventType] ?? null;
}

function renderEmailHtml(input: {
  firstName: string | null;
  template: NotificationTemplate;
  caseUrl: string;
}): string {
  const greeting = input.firstName
    ? `Bonjour ${escapeHtml(input.firstName)},`
    : "Bonjour,";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f8f7;font-family:Arial,sans-serif;color:#17211d"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #dfe6e2;padding:32px"><p style="font-size:14px">${greeting}</p><h1 style="font-size:24px;margin:20px 0 12px">${escapeHtml(input.template.heading)}</h1><p style="font-size:15px;line-height:1.6;color:#526058">${escapeHtml(input.template.message)}</p><a href="${escapeHtml(input.caseUrl)}" style="display:inline-block;margin-top:20px;background:#087a55;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px">${escapeHtml(input.template.actionLabel)}</a><p style="margin-top:28px;font-size:12px;color:#849089">Lydoc · Suivi de vos demandes de remboursement</p></div></div></body></html>`;
}

function applicationUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000")
    .split(",")[0]!
    .trim()
    .replace(/\/$/, "");
}

function safeTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) || "unknown";
}

function readProviderError(
  payload: Record<string, unknown>,
  status: number,
): string {
  const message = typeof payload.message === "string" ? payload.message : "";
  return message
    ? `RESEND_${status}:${message.slice(0, 180)}`
    : `RESEND_HTTP_${status}`;
}

function safeNotificationError(error: unknown): string {
  const message = error instanceof Error ? error.message : "EMAIL_SEND_FAILED";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character]!,
  );
}
