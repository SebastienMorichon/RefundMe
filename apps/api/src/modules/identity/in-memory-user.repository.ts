import { Injectable } from "@nestjs/common";
import type { CreateUserInput, UserRepository } from "@lydoc/application";
import type { User } from "@lydoc/domain";

@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async create(input: CreateUserInput): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      role: "USER",
      createdAt: new Date(),
    };

    this.users.set(user.id, user);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return Array.from(this.users.values()).find((user) => user.email === email) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }
}
