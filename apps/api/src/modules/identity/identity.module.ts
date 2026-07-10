import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { AdminGuard } from "./admin.guard";
import { AuthGuard } from "./auth.guard";
import { NodePasswordHasher } from "./node-password-hasher.service";
import { PrismaUserRepository } from "./prisma-user.repository";
import { SessionService } from "./session.service";

@Module({
  controllers: [IdentityController],
  providers: [AdminGuard, AuthGuard, PrismaUserRepository, NodePasswordHasher, SessionService],
  exports: [AdminGuard, AuthGuard, PrismaUserRepository, SessionService],
})
export class IdentityModule {}
