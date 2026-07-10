import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateUserInput, UserRepository } from "@lydoc/application";
import type { User } from "@lydoc/domain";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateUserInput): Promise<User> {
    let user;

    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new Error("Un compte existe deja avec cet email.");
      }

      throw error;
    }

    return this.toDomain(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    return user ? this.toDomain(user) : null;
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    return user ? this.toDomain(user) : null;
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
