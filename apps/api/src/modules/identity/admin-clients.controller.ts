import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "./admin.guard";
import {
  AdminClientsService,
  type AdminClientFilter,
} from "./admin-clients.service";
import { AuthGuard } from "./auth.guard";

@Controller("admin/clients")
@UseGuards(AuthGuard, AdminGuard)
export class AdminClientsController {
  constructor(private readonly clients: AdminClientsService) {}

  @Post("search")
  async list(@Body() body: unknown) {
    const input = readBody(body);
    return this.clients.getOverview({
      page: readInteger(input.page, 1, 1, 10_000, "La page"),
      limit: readInteger(input.limit, 25, 1, 100, "La taille de page"),
      search: readSearch(input.search),
      filter: readFilter(input.filter),
    });
  }
}

function readBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("La recherche clients est invalide.");
  }
  return value as Record<string, unknown>;
}

function readInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new BadRequestException(`${label} est invalide.`);
  }
  return value;
}

function readSearch(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new BadRequestException("La recherche est invalide.");
  }
  const search = value.trim();
  if (search.length > 254) {
    throw new BadRequestException("La recherche est trop longue.");
  }
  return search;
}

function readFilter(value: unknown): AdminClientFilter {
  if (value === undefined || value === "all") return "all";
  if (
    value === "online" ||
    value === "offline" ||
    value === "unverified" ||
    value === "with_cases" ||
    value === "refunded"
  ) {
    return value;
  }
  throw new BadRequestException("Le filtre client est invalide.");
}
