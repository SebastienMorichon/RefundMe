import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { DiscountType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type PostalProduct = "verte" | "vertesuivi";
export type PricingSettings = Readonly<{
  paymentEnabled: boolean;
  serviceFeeCents: number;
  printingBaseCents: number;
  printingPerAdditionalPageCents: number;
  greenLetterCents: number;
  managedPostageCents: number;
  trackedGreenLetterCents: number;
  defaultPostalProduct: PostalProduct;
  promotionEnabled: boolean;
  promotionLabel: string | null;
  promotionDiscountType: DiscountType | null;
  promotionDiscountValue: number;
  promotionStartsAt: Date | null;
  promotionEndsAt: Date | null;
  updatedAt: Date;
}>;
export type CustomerPostalPricing = Readonly<{
  product: PostalProduct;
  pageCount: number;
  baseServiceFeeCents: number;
  serviceFeeCents: number;
  discountCents: number;
  discountLabel: string | null;
  promoCode: string | null;
  printingCents: number;
  postageCents: number;
  postalTotalCents: number;
  grandTotalCents: number;
}>;

const CONFIGURATION_ID = "default";
const MAX_FEE_CENTS = 100_000;
const MAX_LABEL_LENGTH = 120;

export const DEFAULT_PRICING = Object.freeze({
  paymentEnabled: false,
  serviceFeeCents: 99,
  printingBaseCents: 30,
  printingPerAdditionalPageCents: 30,
  greenLetterCents: 152,
  managedPostageCents: 160,
  trackedGreenLetterCents: 202,
  defaultPostalProduct: "verte" as const,
  promotionEnabled: false,
  promotionLabel: null,
  promotionDiscountType: null,
  promotionDiscountValue: 0,
  promotionStartsAt: null,
  promotionEndsAt: null,
});

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PricingSettings> {
    const configuration = await this.prisma.pricingConfiguration.upsert({
      where: { id: CONFIGURATION_ID },
      create: { id: CONFIGURATION_ID, ...DEFAULT_PRICING },
      update: {},
    });
    return presentPricing(configuration);
  }

  async getPublicStatus() {
    const settings = await this.get();
    return {
      paymentEnabled: settings.paymentEnabled,
      serviceFeeCents: settings.serviceFeeCents,
      promotion: activeGlobalPromotion(settings, new Date())
        ? {
            label: settings.promotionLabel,
            discountType: settings.promotionDiscountType,
            discountValue: settings.promotionDiscountValue,
            startsAt: settings.promotionStartsAt,
            endsAt: settings.promotionEndsAt,
          }
        : null,
    };
  }

  async requirePaymentEnabled(): Promise<void> {
    if (!(await this.get()).paymentEnabled) {
      throw new ServiceUnavailableException(
        "Le paiement en ligne n'est pas encore ouvert par Lydoc.",
      );
    }
  }

  async update(input: Record<string, unknown>, actorId: string): Promise<PricingSettings> {
    const promotionEnabled = readBoolean(input.promotionEnabled, "La promotion");
    const promotionDiscountType = readOptionalDiscountType(input.promotionDiscountType);
    const next = {
      paymentEnabled: readBoolean(input.paymentEnabled, "Le paiement"),
      serviceFeeCents: readFee(input.serviceFeeCents, "Les frais de service"),
      printingBaseCents: readFee(input.printingBaseCents, "Le forfait d'impression"),
      printingPerAdditionalPageCents: readFee(input.printingPerAdditionalPageCents, "Le prix par page supplementaire"),
      greenLetterCents: readFee(input.greenLetterCents, "Le tarif Lettre verte"),
      managedPostageCents: readFee(input.managedPostageCents, "Le cout e-Lettre rouge"),
      trackedGreenLetterCents: readFee(input.trackedGreenLetterCents, "Le tarif Lettre verte suivie"),
      defaultPostalProduct: readPostalProduct(input.defaultPostalProduct),
      promotionEnabled,
      promotionLabel: readOptionalLabel(input.promotionLabel, promotionEnabled),
      promotionDiscountType,
      promotionDiscountValue: readDiscountValue(input.promotionDiscountValue, promotionDiscountType, promotionEnabled),
      promotionStartsAt: readOptionalDate(input.promotionStartsAt, "Le debut de la promotion"),
      promotionEndsAt: readOptionalDate(input.promotionEndsAt, "La fin de la promotion"),
    };
    validateDateRange(next.promotionStartsAt, next.promotionEndsAt);
    const defaultPostage = next.defaultPostalProduct === "verte"
      ? next.managedPostageCents
      : next.trackedGreenLetterCents;
    if (
      next.serviceFeeCents + next.printingBaseCents + defaultPostage === 0
    ) {
      throw new BadRequestException(
        "Le tarif de l'envoi pris en charge ne peut pas etre entierement gratuit.",
      );
    }

    const configuration = await this.prisma.$transaction(async (transaction) => {
      const previous = await transaction.pricingConfiguration.findUnique({ where: { id: CONFIGURATION_ID } });
      const saved = await transaction.pricingConfiguration.upsert({
        where: { id: CONFIGURATION_ID },
        create: { id: CONFIGURATION_ID, ...next, updatedById: actorId },
        update: { ...next, updatedById: actorId },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "PRICING_CONFIGURATION_UPDATED",
          entityType: "PricingConfiguration",
          entityId: CONFIGURATION_ID,
          metadata: {
            previous: previous ? auditPricing(presentPricing(previous)) : DEFAULT_PRICING,
            next: auditPricing(presentPricing(saved)),
          },
        },
      });
      return saved;
    });
    return presentPricing(configuration);
  }

  async listPromoCodes() {
    return this.prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
  }

  async createPromoCode(input: Record<string, unknown>, actorId: string) {
    const data = readPromoCodeInput(input, actorId);
    try {
      const promoCode = await this.prisma.promoCode.create({ data });
      await this.auditPromo(actorId, "PROMO_CODE_CREATED", promoCode.id, { code: promoCode.code });
      return promoCode;
    } catch (error) {
      if (isUniqueConstraint(error)) throw new BadRequestException("Ce code promotionnel existe deja.");
      throw error;
    }
  }

  async updatePromoCode(id: string, input: Record<string, unknown>, actorId: string) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException("Code promotionnel introuvable.");
    const data = readPromoCodeInput(input, actorId);
    try {
      const promoCode = await this.prisma.promoCode.update({ where: { id }, data });
      await this.auditPromo(actorId, "PROMO_CODE_UPDATED", id, {
        previousCode: existing.code,
        code: promoCode.code,
      });
      return promoCode;
    } catch (error) {
      if (isUniqueConstraint(error)) throw new BadRequestException("Ce code promotionnel existe deja.");
      throw error;
    }
  }

  async calculate(pageCount: number, product?: PostalProduct, requestedPromoCode?: string): Promise<CustomerPostalPricing> {
    const settings = await this.get();
    const now = new Date();
    const normalizedCode = normalizePromoCode(requestedPromoCode);
    const code = normalizedCode
      ? await this.prisma.promoCode.findUnique({ where: { code: normalizedCode } })
      : null;
    if (normalizedCode && (!code || !isPromotionActive(code, now))) {
      throw new BadRequestException("Ce code promotionnel est invalide ou expire.");
    }
    const candidates: DiscountCandidate[] = [];
    if (activeGlobalPromotion(settings, now)) {
      candidates.push({
        label: settings.promotionLabel!,
        type: settings.promotionDiscountType!,
        value: settings.promotionDiscountValue,
        promoCode: null,
      });
    }
    if (code) {
      candidates.push({ label: code.label, type: code.discountType, value: code.discountValue, promoCode: code.code });
    }
    return calculateCustomerPostalPricing(
      settings,
      pageCount,
      product ?? settings.defaultPostalProduct,
      bestDiscount(settings.serviceFeeCents, candidates),
    );
  }

  private async auditPromo(actorId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        entityType: "PromoCode",
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}

type DiscountCandidate = { label: string; type: DiscountType; value: number; promoCode: string | null };

export function calculateCustomerPostalPricing(
  settings: Omit<PricingSettings, "updatedAt">,
  pageCount: number,
  product: PostalProduct,
  discount: (DiscountCandidate & { discountCents: number }) | null = null,
): CustomerPostalPricing {
  const normalizedPageCount = Math.max(1, Math.trunc(pageCount));
  const printingCents = settings.printingBaseCents + Math.max(0, normalizedPageCount - 1) * settings.printingPerAdditionalPageCents;
  const postageCents = product === "verte" ? settings.managedPostageCents : settings.trackedGreenLetterCents;
  const postalTotalCents = printingCents + postageCents;
  const discountCents = Math.min(settings.serviceFeeCents, discount?.discountCents ?? 0);
  const serviceFeeCents = settings.serviceFeeCents - discountCents;
  return {
    product,
    pageCount: normalizedPageCount,
    baseServiceFeeCents: settings.serviceFeeCents,
    serviceFeeCents,
    discountCents,
    discountLabel: discount?.label ?? null,
    promoCode: discount?.promoCode ?? null,
    printingCents,
    postageCents,
    postalTotalCents,
    grandTotalCents: serviceFeeCents + postalTotalCents,
  };
}

function bestDiscount(serviceFeeCents: number, candidates: DiscountCandidate[]) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      discountCents: candidate.type === "PERCENTAGE"
        ? Math.round((serviceFeeCents * candidate.value) / 100)
        : candidate.value,
    }))
    .sort((a, b) => b.discountCents - a.discountCents)[0] ?? null;
}

function activeGlobalPromotion(settings: PricingSettings, now: Date): boolean {
  return Boolean(
    settings.promotionEnabled && settings.promotionLabel && settings.promotionDiscountType &&
    settings.promotionDiscountValue > 0 &&
    isPromotionActive(
      {
        startsAt: settings.promotionStartsAt,
        endsAt: settings.promotionEndsAt,
      },
      now,
    ),
  );
}

function isPromotionActive(value: { enabled?: boolean; startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  return value.enabled !== false && (!value.startsAt || value.startsAt <= now) && (!value.endsAt || value.endsAt >= now);
}

function readPromoCodeInput(input: Record<string, unknown>, actorId: string) {
  const discountType = readRequiredDiscountType(input.discountType);
  const startsAt = readOptionalDate(input.startsAt, "Le debut du code");
  const endsAt = readOptionalDate(input.endsAt, "La fin du code");
  validateDateRange(startsAt, endsAt);
  const code = normalizePromoCode(input.code);
  if (!code || !/^[A-Z0-9_-]{3,40}$/.test(code)) {
    throw new BadRequestException("Le code doit contenir 3 a 40 lettres, chiffres, tirets ou underscores.");
  }
  return {
    code,
    label: readRequiredLabel(input.label),
    discountType,
    discountValue: readDiscountValue(input.discountValue, discountType, true),
    enabled: readBoolean(input.enabled, "Le code promotionnel"),
    startsAt,
    endsAt,
    updatedById: actorId,
  };
}

function normalizePromoCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function auditPricing(settings: PricingSettings) {
  return {
    ...settings,
    updatedAt: settings.updatedAt.toISOString(),
    promotionStartsAt: settings.promotionStartsAt?.toISOString() ?? null,
    promotionEndsAt: settings.promotionEndsAt?.toISOString() ?? null,
  };
}

function presentPricing(configuration: {
  paymentEnabled: boolean;
  serviceFeeCents: number;
  printingBaseCents: number;
  printingPerAdditionalPageCents: number;
  greenLetterCents: number;
  managedPostageCents: number;
  trackedGreenLetterCents: number;
  defaultPostalProduct: string;
  promotionEnabled: boolean;
  promotionLabel: string | null;
  promotionDiscountType: DiscountType | null;
  promotionDiscountValue: number;
  promotionStartsAt: Date | null;
  promotionEndsAt: Date | null;
  updatedAt: Date;
}): PricingSettings {
  return {
    ...configuration,
    defaultPostalProduct: configuration.defaultPostalProduct === "verte" ? "verte" : "vertesuivi",
  };
}

function readFee(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_FEE_CENTS) {
    throw new BadRequestException(`${label} doit etre un montant valide compris entre 0 et 1 000 EUR.`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new BadRequestException(`${label} doit etre active ou desactive.`);
  return value;
}

function readPostalProduct(value: unknown): PostalProduct {
  if (value !== "verte" && value !== "vertesuivi") throw new BadRequestException("Le mode d'envoi postal est invalide.");
  return value;
}

function readOptionalDiscountType(value: unknown): DiscountType | null {
  return value === null || value === "" ? null : readRequiredDiscountType(value);
}

function readRequiredDiscountType(value: unknown): DiscountType {
  if (value !== "FIXED_AMOUNT" && value !== "PERCENTAGE") throw new BadRequestException("Le type de remise est invalide.");
  return value;
}

function readDiscountValue(value: unknown, type: DiscountType | null, required: boolean): number {
  if (!required && (value === 0 || value === null || value === undefined)) return 0;
  if (!type) throw new BadRequestException("Choisissez le type de remise.");
  const maximum = type === "PERCENTAGE" ? 100 : MAX_FEE_CENTS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new BadRequestException(type === "PERCENTAGE" ? "Le pourcentage doit etre compris entre 1 et 100." : "Le montant de la remise est invalide.");
  }
  return value;
}

function readOptionalLabel(value: unknown, required: boolean): string | null {
  if (!required && (value === null || value === undefined || value === "")) return null;
  return readRequiredLabel(value);
}

function readRequiredLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label || label.length > MAX_LABEL_LENGTH) throw new BadRequestException(`Le libelle doit contenir 1 a ${MAX_LABEL_LENGTH} caracteres.`);
  return label;
}

function readOptionalDate(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException(`${label} est invalide.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} est invalide.`);
  return date;
}

function validateDateRange(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt && endsAt && startsAt >= endsAt) throw new BadRequestException("La date de fin doit suivre la date de debut.");
}

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}
