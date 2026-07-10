import { normalizeEmail, type User } from "@lydoc/domain";
import type { PasswordHasher } from "../../ports/password-hasher";
import type { UserRepository } from "../../ports/user-repository";

export class AuthenticateUser {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(input: { email: string; password: string }): Promise<User> {
    const user = await this.users.findByEmail(normalizeEmail(input.email));

    if (!user || !(await this.passwordHasher.verify(input.password, user.passwordHash))) {
      throw new Error("Identifiants invalides.");
    }

    return user;
  }
}

