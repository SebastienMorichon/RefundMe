import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CustomerProfileData } from "./customer-profile";
import { presentCustomerProfile } from "./customer-profile";
import { AuthGuard } from "./auth.guard";
import type { AuthenticatedRequest } from "./auth.types";
import { PrismaService } from "../prisma/prisma.service";
import {
  lockCustomerProfile,
  lockGeneratedPacketCase,
  lockStripeCheckoutCase,
} from "../../platform/transaction-locks";

type UpdateProfileBody = Partial<Record<keyof CustomerProfileData, unknown>>;

@Controller("profile")
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Req() request: AuthenticatedRequest) {
    const user = await this.findUser(request.user!.id);
    return { profile: presentCustomerProfile(user) };
  }

  @Patch()
  async update(
    @Body() body: UpdateProfileBody,
    @Req() request: AuthenticatedRequest,
  ) {
    const profile = parseProfile(body);
    const user = await this.prisma.$transaction(async (transaction) => {
      const ownerId = request.user!.id;
      await lockCustomerProfile(transaction, ownerId);
      const activeAccount = await transaction.user.findFirst({
        where: { id: ownerId, accountDeletedAt: null },
        select: { id: true },
      });
      if (!activeAccount) throw new UnauthorizedException("Session invalide.");
      const cases = await transaction.administrativeCase.findMany({
        where: { ownerId },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      for (const administrativeCase of cases) {
        await lockStripeCheckoutCase(transaction, administrativeCase.id);
        await lockGeneratedPacketCase(transaction, administrativeCase.id);
      }
      const pendingPayment = await transaction.payment.findFirst({
        where: { status: "PENDING", case: { ownerId } },
        select: { id: true },
      });
      if (pendingPayment) {
        throw new BadRequestException(
          "Votre profil ne peut pas etre modifie pendant qu'un paiement Stripe est ouvert.",
        );
      }

      const updated = await transaction.user.updateMany({
        where: { id: ownerId, accountDeletedAt: null },
        data: profile,
      });
      if (updated.count !== 1) {
        throw new UnauthorizedException("Session invalide.");
      }
      const updatedUser = await transaction.user.findFirst({
        where: { id: ownerId, accountDeletedAt: null },
        select: profileSelection,
      });
      if (!updatedUser) throw new UnauthorizedException("Session invalide.");
      await transaction.postalShipment.deleteMany({
        where: {
          status: { in: ["DRAFT", "QUOTED", "FAILED", "CANCELLED"] },
          case: {
            ownerId: updatedUser.id,
            status: "READY_TO_PAY",
            generatedPackets: { none: {} },
          },
        },
      });
      await transaction.administrativeCase.updateMany({
        where: {
          ownerId: updatedUser.id,
          status: "READY_TO_PAY",
          generatedPackets: { none: {} },
        },
        data: { validatedAt: null, validationSnapshotJson: Prisma.DbNull },
      });
      await transaction.auditLog.create({
        data: {
          actorId: updatedUser.id,
          action: "CUSTOMER_PROFILE_UPDATED",
          entityType: "User",
          entityId: updatedUser.id,
          metadata: { completed: presentCustomerProfile(updatedUser).complete },
        },
      });
      return updatedUser;
    });
    return { profile: presentCustomerProfile(user) };
  }

  private async findUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...profileSelection, accountDeletedAt: true },
    });
    if (!user || user.accountDeletedAt) {
      throw new UnauthorizedException("Session invalide.");
    }
    return user;
  }
}

const profileSelection = {
  id: true,
  firstName: true,
  lastName: true,
  postalAddress: true,
  postalCode: true,
  city: true,
  country: true,
  phoneNumber: true,
  operatorCustomerReference: true,
} as const;

function parseProfile(body: UpdateProfileBody) {
  const firstName = readField(body.firstName, "Prenom", 80, true);
  const lastName = readField(body.lastName, "Nom", 80, true);
  const postalAddress = readField(
    body.postalAddress,
    "Adresse postale",
    200,
    true,
  );
  const postalCode = readField(body.postalCode, "Code postal", 20, true);
  const city = readField(body.city, "Ville", 100, true);
  const country = readField(body.country, "Pays", 80, true);
  const phoneNumber = readField(
    body.phoneNumber,
    "Numero de telephone",
    30,
    true,
  );
  const operatorCustomerReference = readField(
    body.operatorCustomerReference,
    "Reference client operateur",
    80,
    false,
  );

  if (!/^[+0-9][0-9 .()/-]{5,29}$/.test(phoneNumber)) {
    throw new BadRequestException("Le numero de telephone est invalide.");
  }

  return {
    firstName,
    lastName,
    postalAddress,
    postalCode,
    city,
    country,
    phoneNumber,
    operatorCustomerReference,
  };
}

function readField(
  value: unknown,
  label: string,
  maxLength: number,
  required: true,
): string;
function readField(
  value: unknown,
  label: string,
  maxLength: number,
  required: false,
): string | null;
function readField(
  value: unknown,
  label: string,
  maxLength: number,
  required: boolean,
): string | null {
  if (typeof value !== "string") {
    if (required) throw new BadRequestException(`${label} est requis.`);
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized && required)
    throw new BadRequestException(`${label} est requis.`);
  if (normalized.length > maxLength)
    throw new BadRequestException(`${label} est trop long.`);
  return normalized || null;
}
