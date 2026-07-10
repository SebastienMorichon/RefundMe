import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import {
  AuthenticateUser,
  RegisterUser,
  type PasswordHasher,
  type UserRepository,
} from "@lydoc/application";
import { AuthenticatedRequest, readCookie } from "./auth.types";
import { NodePasswordHasher } from "./node-password-hasher.service";
import { PrismaUserRepository } from "./prisma-user.repository";
import { SessionService } from "./session.service";

type AuthBody = Readonly<{
  email?: string;
  password?: string;
}>;

@Controller("auth")
export class IdentityController {
  private readonly registerUser: RegisterUser;
  private readonly authenticateUser: AuthenticateUser;

  constructor(
    users: PrismaUserRepository,
    passwordHasher: NodePasswordHasher,
    private readonly sessions: SessionService,
  ) {
    this.registerUser = new RegisterUser(
      users as UserRepository,
      passwordHasher as PasswordHasher,
    );
    this.authenticateUser = new AuthenticateUser(
      users as UserRepository,
      passwordHasher as PasswordHasher,
    );
  }

  @Post("register")
  async register(@Body() body: AuthBody, @Res({ passthrough: true }) response: Response) {
    const user = await this.handleAuthError(() =>
      this.registerUser.execute({
        email: body.email ?? "",
        password: body.password ?? "",
        role: isBootstrapAdminEmail(body.email ?? "") ? "ADMIN" : "USER",
      }),
    );

    this.attachSessionCookie(response, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Post("login")
  async login(@Body() body: AuthBody, @Res({ passthrough: true }) response: Response) {
    const user = await this.handleAuthError(() =>
      this.authenticateUser.execute({
        email: body.email ?? "",
        password: body.password ?? "",
      }),
    );

    this.attachSessionCookie(response, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    const session = this.sessions.readCookieValue(
      readCookie(request.headers.cookie, this.sessions.cookieName),
    );

    if (!session) {
      throw new UnauthorizedException("Session invalide.");
    }

    return { user: session };
  }

  private attachSessionCookie(response: Response, user: { id: string; email: string; role: string }) {
    const value = this.sessions.createCookieValue(user);

    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${this.sessions.cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${this.sessions.maxAgeSeconds}${secure}`,
    );
  }

  private async handleAuthError<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Requete invalide.";

      if (message === "Identifiants invalides.") {
        throw new UnauthorizedException(message);
      }

      throw new BadRequestException(message);
    }
  }
}

function isBootstrapAdminEmail(email: string): boolean {
  const allowedEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return allowedEmails.includes(email.trim().toLowerCase());
}
