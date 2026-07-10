import { normalizeEmail, type User } from "@lydoc/domain";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { UserRepository } from "../../ports/user-repository";

export class RegisterUser {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(input: { email: string; password: string }): Promise<User> {
    const email = normalizeEmail(input.email);

    if (input.password.length < 10) {
      throw new Error("Le mot de passe doit contenir au moins 10 caracteres.");
    }

    const existingUser = await this.users.findByEmail(email);

    if (existingUser) {
      throw new Error("Un compte existe deja avec cet email.");
    }

    return this.users.create({
      email,
      passwordHash: await this.passwordHasher.hash(input.password),
    });
  }
}

