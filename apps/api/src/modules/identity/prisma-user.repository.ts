import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateUserInput, UserRepository } from "@lydoc/application";
import type { User } from "@lydoc/domain";
import { PrismaService } from "../prisma/prisma.service";

export class RegistrationConflictError extends Error {
  constructor() {
    super("Registration conflict");
    this.name = "RegistrationConflictError";
  }
}

export type AuthenticationUser = User &
  Readonly<{
    emailVerifiedAt: Date | null;
    mfaEnabledAt: Date | null;
  }>;

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateUserInput): Promise<User> {
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          role: "USER",
        },
      });
      return this.toDomain(user);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new RegistrationConflictError();
      throw error;
    }
  }

  async createPendingRegistration(input: {
    email: string;
    passwordHash: string;
  }): Promise<User> {
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          role: "USER",
          consentVersion: null,
          consentedAt: null,
          emailVerifiedAt: null,
        },
      });
      return this.toDomain(user);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new RegistrationConflictError();
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    return user && !user.accountDeletedAt ? this.toDomain(user) : null;
  }

  async findForAuthentication(
    email: string,
  ): Promise<AuthenticationUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user && !user.accountDeletedAt
      ? {
          ...this.toDomain(user),
          emailVerifiedAt: user.emailVerifiedAt,
          mfaEnabledAt: user.mfaEnabledAt,
        }
      : null;
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    return user && !user.accountDeletedAt ? this.toDomain(user) : null;
  }

  private toDomain(user: {
    id: string;
    email: string;
    passwordHash: string;
    role: "USER" | "ADMIN";
    createdAt: Date;
  }): User {
    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
