import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ContactDeliveryStatus, Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { readAuthenticationSecret } from "../identity/authentication-secret";

const allowedSubjects = new Set([
  "Question sur un remboursement",
  "Aide avec un document",
  "Suivi d'un dossier",
  "Partenariat",
  "Autre demande",
]);
const pendingReservationLifetimeMs = 15 * 60_000;
const rollingBudgetWindowMs = 24 * 60 * 60_000;
const attemptBudgetWindowMs = 60 * 60_000;
const contactLogRetentionMs = 30 * 24 * 60 * 60_000;

@Injectable()
export class ContactService {
  private readonly hashingSecret = readAuthenticationSecret();

  constructor(private readonly prisma: PrismaService) {}

  async submit(value: unknown, clientAddress = "unknown"): Promise<void> {
    const input = parseContact(value);
    if (input.website) return;

    const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
    const from = process.env.RESEND_FROM_EMAIL?.trim() ?? "";
    const to = process.env.CONTACT_TO_EMAIL?.trim() ?? "";
    if (!apiKey.startsWith("re_") || !from || !isEmail(to)) {
      throw new ServiceUnavailableException(
        "Le formulaire de contact est temporairement indisponible.",
      );
    }

    const reservation = await this.reserveDelivery(
      input.email,
      clientAddress,
    );

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `contact-${reservation.id}`,
        },
        body: JSON.stringify({
          from,
          to: [to],
          reply_to: input.email,
          subject: `[Lydoc contact] ${input.subject}`,
          text: [
            `Nom: ${input.firstName} ${input.lastName}`,
            `E-mail: ${input.email}`,
            `Sujet: ${input.subject}`,
            "",
            input.message,
          ].join("\n"),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      await this.completeDelivery(reservation.id, ContactDeliveryStatus.FAILED);
      throw new ServiceUnavailableException(
        "Le formulaire de contact est temporairement indisponible.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      await this.completeDelivery(reservation.id, ContactDeliveryStatus.FAILED);
      throw new ServiceUnavailableException(
        "Le formulaire de contact est temporairement indisponible.",
      );
    }
    await this.completeDelivery(reservation.id, ContactDeliveryStatus.SENT);
  }

  private async reserveDelivery(
    email: string,
    clientAddress: string,
  ): Promise<{ id: string }> {
    const emailHash = this.hashIdentifier(`email:${email}`);
    const clientHash = this.hashIdentifier(`client:${clientAddress}`);
    const now = new Date();
    const budgetStart = new Date(now.getTime() - rollingBudgetWindowMs);
    const pendingStart = new Date(
      now.getTime() - pendingReservationLifetimeMs,
    );
    const attemptStart = new Date(now.getTime() - attemptBudgetWindowMs);
    const globalLimit = readBoundedLimit("CONTACT_DAILY_LIMIT", 200, 10_000);
    const emailLimit = readBoundedLimit("CONTACT_DAILY_EMAIL_LIMIT", 3, 20);
    const clientLimit = readBoundedLimit("CONTACT_DAILY_CLIENT_LIMIT", 20, 200);
    const attemptLimit = readBoundedLimit(
      "CONTACT_HOURLY_ATTEMPT_LIMIT",
      400,
      10_000,
    );
    const emailAttemptLimit = readBoundedLimit(
      "CONTACT_HOURLY_EMAIL_ATTEMPT_LIMIT",
      10,
      100,
    );
    const clientAttemptLimit = readBoundedLimit(
      "CONTACT_HOURLY_CLIENT_ATTEMPT_LIMIT",
      40,
      1_000,
    );

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${"contact-budget:global"}))
      `;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`contact-budget:client:${clientHash}`}))
      `;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`contact-budget:email:${emailHash}`}))
      `;
      await transaction.contactSubmission.deleteMany({
        where: {
          createdAt: { lt: new Date(now.getTime() - contactLogRetentionMs) },
        },
      });

      const activeReservationWhere: Prisma.ContactSubmissionWhereInput = {
        OR: [
          {
            status: ContactDeliveryStatus.SENT,
            createdAt: { gte: budgetStart },
          },
          {
            status: ContactDeliveryStatus.PENDING,
            createdAt: { gte: pendingStart },
          },
        ],
      };
      const [
        globalCount,
        emailCount,
        clientCount,
        globalAttempts,
        emailAttempts,
        clientAttempts,
      ] = await Promise.all([
        transaction.contactSubmission.count({
          where: activeReservationWhere,
        }),
        transaction.contactSubmission.count({
          where: { ...activeReservationWhere, emailHash },
        }),
        transaction.contactSubmission.count({
          where: { ...activeReservationWhere, clientHash },
        }),
        transaction.contactSubmission.count({
          where: { createdAt: { gte: attemptStart } },
        }),
        transaction.contactSubmission.count({
          where: { emailHash, createdAt: { gte: attemptStart } },
        }),
        transaction.contactSubmission.count({
          where: { clientHash, createdAt: { gte: attemptStart } },
        }),
      ]);
      if (
        globalCount >= globalLimit ||
        emailCount >= emailLimit ||
        clientCount >= clientLimit ||
        globalAttempts >= attemptLimit ||
        emailAttempts >= emailAttemptLimit ||
        clientAttempts >= clientAttemptLimit
      ) {
        throw new HttpException(
          "Trop de demandes. Reessayez plus tard.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return transaction.contactSubmission.create({
        data: { emailHash, clientHash },
        select: { id: true },
      });
    });
  }

  private async completeDelivery(
    id: string,
    status: ContactDeliveryStatus,
  ): Promise<void> {
    await this.prisma.contactSubmission.updateMany({
      where: { id, status: ContactDeliveryStatus.PENDING },
      data: { status, completedAt: new Date() },
    });
  }

  private hashIdentifier(value: string): string {
    return createHmac("sha256", this.hashingSecret)
      .update("lydoc-contact-budget-v1\0")
      .update(value)
      .digest("hex");
  }
}

function parseContact(value: unknown): {
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  message: string;
  website: string;
} {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const firstName = readText(body.firstName, 1, 80);
  const lastName = readText(body.lastName, 1, 80);
  const email = readText(body.email, 3, 254).toLowerCase();
  const subject = readText(body.subject, 1, 80);
  const message = readText(body.message, 10, 4_000);
  const website = readText(body.website ?? "", 0, 200);
  if (
    !isEmail(email) ||
    !allowedSubjects.has(subject) ||
    body.consentAccepted !== true
  ) {
    throw new BadRequestException("Les informations de contact sont invalides.");
  }
  return { firstName, lastName, email, subject, message, website };
}

function readText(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string") {
    throw new BadRequestException("Les informations de contact sont invalides.");
  }
  const normalized = value
    .normalize("NFKC")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 0x09 || code === 0x0a || code === 0x0d ||
        (code >= 0x20 && code !== 0x7f);
    })
    .join("")
    .trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new BadRequestException("Les informations de contact sont invalides.");
  }
  return normalized;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readBoundedLimit(name: string, fallback: number, maximum: number) {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured >= 1 && configured <= maximum
    ? configured
    : fallback;
}
