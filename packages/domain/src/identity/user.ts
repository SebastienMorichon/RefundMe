export const userRoles = ["USER", "ADMIN"] as const;

export type UserRole = (typeof userRoles)[number];

export type User = Readonly<{
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
}>;

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Email invalide.");
  }

  return normalized;
}

