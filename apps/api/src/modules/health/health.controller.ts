import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async readHealth() {
    await this.assertDatabaseReady();

    return {
      status: "ok",
      service: "lydoc-api",
      database: "ready",
    };
  }

  @Get("live")
  readLiveness() {
    return { status: "ok", service: "lydoc-api" };
  }

  @Get("ready")
  async readReadiness() {
    await this.assertDatabaseReady();

    return { status: "ok", database: "ready" };
  }

  private async assertDatabaseReady(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException("Base de donnees indisponible.");
    }
  }
}
