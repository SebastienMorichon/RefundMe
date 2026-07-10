import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { AuthGuard } from "./auth.guard";
import { NodePasswordHasher } from "./node-password-hasher.service";
import { PrismaUserRepository } from "./prisma-user.repository";
import { SessionService } from "./session.service";

@Module({
  controllers: [IdentityController],
  providers: [AuthGuard, PrismaUserRepository, NodePasswordHasher, SessionService],
  exports: [AuthGuard, PrismaUserRepository, SessionService],
})
export class IdentityModule {}
