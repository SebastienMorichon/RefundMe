import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type PostalProduct = "verte" | "vertesuivi";

export type PricingSettings = Readonly<{
  serviceFeeCents: number;
  printingBaseCents: number;
  printingPerAdditionalPageCents: number;
  greenLetterCents: number;
  trackedGreenLetterCents: number;
  defaultPostalProduct: PostalProduct;
  updatedAt: Date;
}>;

export type CustomerPostalPricing = Readonly<{
  product: PostalProduct;
  pageCount: number;
  serviceFeeCents: number;
  printingCents: number;
  postageCents: number;
  postalTotalCents: number;
  grandTotalCents: number;
}>;

const CONFIGURATION_ID = "default";
const MAX_FEE_CENTS = 100_000;

export const DEFAULT_PRICING = Object.freeze({
  serviceFeeCents: 299,
  printingBaseCents: 90,
  printingPerAdditionalPageCents: 31,
  greenLetterCents: 152,
  trackedGreenLetterCents: 202,
  defaultPostalProduct: "vertesuivi" as const,
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

  async update(input: Record<string, unknown>, actorId: string): Promise<PricingSettings> {
    const next = {
      serviceFeeCents: readFee(input.serviceFeeCents, "Les frais de service"),
      printingBaseCents: readFee(input.printingBaseCents, "Le forfait d'impression"),
      printingPerAdditionalPageCents: readFee(
        input.printingPerAdditionalPageCents,
        "Le prix par page supplementaire",
      ),
      greenLetterCents: readFee(input.greenLetterCents, "Le tarif Lettre verte"),
      trackedGreenLetterCents: readFee(
        input.trackedGreenLetterCents,
        "Le tarif Lettre verte suivie",
      ),
      defaultPostalProduct: readPostalProduct(input.defaultPostalProduct),
    };
    const defaultPostage = next.defaultPostalProduct === "verte"
      ? next.greenLetterCents
      : next.trackedGreenLetterCents;
    if (
      next.serviceFeeCents
      + next.printingBaseCents
      + next.printingPerAdditionalPageCents
      + defaultPostage === 0
    ) {
      throw new BadRequestException("Le tarif de l'envoi pris en charge ne peut pas etre entierement gratuit.");
    }

    const configuration = await this.prisma.$transaction(async (transaction) => {
      const previous = await transaction.pricingConfiguration.findUnique({
        where: { id: CONFIGURATION_ID },
      });
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

  async calculate(pageCount: number, product?: PostalProduct): Promise<CustomerPostalPricing> {
    const settings = await this.get();
    return calculateCustomerPostalPricing(settings, pageCount, product ?? settings.defaultPostalProduct);
  }
}

export function calculateCustomerPostalPricing(
  settings: Omit<PricingSettings, "updatedAt">,
  pageCount: number,
  product: PostalProduct,
): CustomerPostalPricing {
  const normalizedPageCount = Math.max(1, Math.trunc(pageCount));
  const printingCents = settings.printingBaseCents
    + Math.max(0, normalizedPageCount - 1) * settings.printingPerAdditionalPageCents;
  const postageCents = product === "verte"
    ? settings.greenLetterCents
    : settings.trackedGreenLetterCents;
  const postalTotalCents = printingCents + postageCents;

  return {
    product,
    pageCount: normalizedPageCount,
    serviceFeeCents: settings.serviceFeeCents,
    printingCents,
    postageCents,
    postalTotalCents,
    grandTotalCents: settings.serviceFeeCents + postalTotalCents,
  };
}

function auditPricing(settings: PricingSettings) {
  return { ...settings, updatedAt: settings.updatedAt.toISOString() };
}

function presentPricing(configuration: {
  serviceFeeCents: number;
  printingBaseCents: number;
  printingPerAdditionalPageCents: number;
  greenLetterCents: number;
  trackedGreenLetterCents: number;
  defaultPostalProduct: string;
  updatedAt: Date;
}): PricingSettings {
  return {
    serviceFeeCents: configuration.serviceFeeCents,
    printingBaseCents: configuration.printingBaseCents,
    printingPerAdditionalPageCents: configuration.printingPerAdditionalPageCents,
    greenLetterCents: configuration.greenLetterCents,
    trackedGreenLetterCents: configuration.trackedGreenLetterCents,
    defaultPostalProduct: configuration.defaultPostalProduct === "verte" ? "verte" : "vertesuivi",
    updatedAt: configuration.updatedAt,
  };
}

function readFee(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value > MAX_FEE_CENTS) {
    throw new BadRequestException(`${label} doit etre un montant valide compris entre 0 et 1 000 EUR.`);
  }
  return value;
}

function readPostalProduct(value: unknown): PostalProduct {
  if (value !== "verte" && value !== "vertesuivi") {
    throw new BadRequestException("Le mode d'envoi postal est invalide.");
  }
  return value;
}
