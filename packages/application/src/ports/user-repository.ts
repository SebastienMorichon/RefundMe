import type { User } from "@lydoc/domain";

export type CreateUserInput = Readonly<{
  email: string;
  passwordHash: string;
}>;

export interface UserRepository {
  create(input: CreateUserInput): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

