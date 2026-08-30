import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeEmail } from "@lydoc/domain";
import {
  AccountDataRightsService,
  accountExportResources,
  type AccountExportResource,
} from "./account-data-rights.service";
import { AuthGuard } from "./auth.guard";
import type { AuthenticatedRequest } from "./auth.types";
import {
  AdminMfaNotConfiguredError,
  AdminMfaService,
  InvalidAdminMfaError,
} from "./admin-mfa.service";
import {
  canExposeIdentityTokens,
  IdentityTokenService,
  InvalidCurrentPasswordError,
  InvalidIdentityTokenError,
  PasswordReuseError,
  type TestOnlyIdentityToken,
} from "./identity-token.service";
import { NodePasswordHasher } from "./node-password-hasher.service";
import { PersistentAuthBudgetService } from "./persistent-auth-budget.service";
import {
  PrismaUserRepository,
  RegistrationConflictError,
} from "./prisma-user.repository";
import { SessionService, type CreatedSession } from "./session.service";

export const CURRENT_LEGAL_CONSENT_VERSION = "2026-08-03.v1";

const minimumPasswordLength = 12;
const maximumPasswordLength = 256;
const maximumPasswordBytes = 1_024;
const maximumEmailLength = 254;
const invalidLoginPassword = "invalid-login-input";
const invalidCredentialsMessage = "Identifiants invalides.";
const genericRegistrationMessage =
  "Inscription impossible. Verifiez les informations fournies.";
const genericEmailDispatchMessage =
  "Si cette adresse peut etre utilisee, un e-mail sera envoye.";
const invalidIdentityTokenMessage = "Lien invalide ou expire.";

type AuthBody = Readonly<{
  email?: unknown;
  password?: unknown;
}>;

type RegistrationBody = AuthBody &
  Readonly<{
    consentAccepted?: unknown;
    consentVersion?: unknown;
  }>;

type TokenBody = Readonly<{ token?: unknown }>;
type VerifyEmailBody = TokenBody &
  Readonly<{
    password?: unknown;
    consentAccepted?: unknown;
    consentVersion?: unknown;
  }>;
type ResetPasswordBody = TokenBody & Readonly<{ newPassword?: unknown }>;
type ChangePasswordBody = Readonly<{
  currentPassword?: unknown;
  newPassword?: unknown;
}>;
type MfaVerifyBody = Readonly<{
  challengeToken?: unknown;
  code?: unknown;
}>;
type DeleteAccountBody = Readonly<{ currentPassword?: unknown }>;

@Controller("auth")
export class IdentityController {
  constructor(
    private readonly users: PrismaUserRepository,
    private readonly passwordHasher: NodePasswordHasher,
    private readonly sessions: SessionService,
    private readonly identityTokens: IdentityTokenService,
    private readonly adminMfa: AdminMfaService,
    private readonly budgets: PersistentAuthBudgetService,
    private readonly dataRights: AccountDataRightsService,
  ) {}

  @Post("register")
  async register(@Body() body: RegistrationBody) {
    assertConsent(body);
    const email = readRegistrationEmail(body.email);
    const passwordHash = this.passwordHasher.createUnusableHash();
    const startedAt = Date.now();
    await this.budgets.consume("REGISTER", email);

    try {
      await this.users.createPendingRegistration({
        email,
        passwordHash,
      });
    } catch (error) {
      if (!(error instanceof RegistrationConflictError)) throw error;
    }
    const token =
      await this.identityTokens.requestRegistrationVerification(email);
    await padIdentityDispatchResponse(startedAt);
    return verificationEmailAccepted(token);
  }

  @Post("resend-verification")
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@Body() body: Readonly<{ email?: unknown }>) {
    const startedAt = Date.now();
    const token = await this.identityTokens.requestEmailVerification(
      readOptionalEmail(body.email),
    );
    await padIdentityDispatchResponse(startedAt);
    return verificationEmailAccepted(token);
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() body: VerifyEmailBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertConsent(body);
    const password = readNewPassword(body.password);
    try {
      const user = await this.identityTokens.verifyEmail(
        readOpaqueToken(body.token),
        password,
        CURRENT_LEGAL_CONSENT_VERSION,
        new Date(),
      );
      const session = await this.sessions.createSession(user.id);
      this.attachSessionCookie(response, session);
      return { verified: true, user: presentUser(session.user) };
    } catch (error) {
      if (error instanceof InvalidIdentityTokenError) {
        throw new BadRequestException(invalidIdentityTokenMessage);
      }
      throw error;
    }
  }

  @Post("login")
  async login(
    @Body() body: AuthBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = readLoginInput(body);
    const user = input.email
      ? await this.users.findForAuthentication(input.email)
      : null;
    const passwordMatches = await this.passwordHasher.verifyWithDummy(
      input.password,
      user?.passwordHash,
    );

    if (!input.valid || !user || !passwordMatches) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        code: "EMAIL_NOT_VERIFIED",
        message: "Adresse e-mail non verifiee.",
      });
    }
    if (user.role === "ADMIN") {
      if (!user.mfaEnabledAt) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          code: "ADMIN_MFA_NOT_CONFIGURED",
          message: "MFA administrateur non configure.",
        });
      }
      try {
        const challenge = await this.adminMfa.createLoginChallenge(user.id);
        throw new UnauthorizedException({
          statusCode: HttpStatus.UNAUTHORIZED,
          code: "MFA_REQUIRED",
          message: "Code MFA requis.",
          mfaChallengeToken: challenge.challengeToken,
          expiresInSeconds: challenge.expiresInSeconds,
        });
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        if (error instanceof AdminMfaNotConfiguredError) {
          throw new ForbiddenException({
            statusCode: HttpStatus.FORBIDDEN,
            code: "ADMIN_MFA_NOT_CONFIGURED",
            message: "MFA administrateur non configure.",
          });
        }
        throw error;
      }
    }

    const session = await this.sessions.createSession(user.id);
    this.attachSessionCookie(response, session);
    return { user: presentUser(session.user) };
  }

  @Post("mfa/verify")
  @HttpCode(HttpStatus.OK)
  async verifyAdminMfa(
    @Body() body: MfaVerifyBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challengeToken = readOpaqueToken(body.challengeToken);
    const code = readMfaCode(body.code);
    try {
      const admin = await this.adminMfa.verifyLoginChallenge(
        challengeToken,
        code,
      );
      const session = await this.sessions.createSession(admin.id, {
        mfaVerified: true,
      });
      this.attachSessionCookie(response, session);
      return { user: presentUser(session.user), mfaVerified: true };
    } catch (error) {
      if (error instanceof InvalidAdminMfaError) {
        throw new UnauthorizedException({
          statusCode: HttpStatus.UNAUTHORIZED,
          code: "MFA_INVALID",
          message: "Code MFA invalide ou expire.",
        });
      }
      throw error;
    }
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() body: Readonly<{ email?: unknown }>) {
    const startedAt = Date.now();
    const token = await this.identityTokens.requestPasswordReset(
      readOptionalEmail(body.email),
    );
    await padIdentityDispatchResponse(startedAt);
    return passwordResetEmailAccepted(token);
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: ResetPasswordBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readOpaqueToken(body.token);
    const password = readNewPassword(body.newPassword);
    try {
      await this.identityTokens.resetPassword(token, password);
    } catch (error) {
      if (error instanceof InvalidIdentityTokenError) {
        throw new BadRequestException(invalidIdentityTokenMessage);
      }
      throw error;
    }
    this.clearAuthenticationCookies(response);
    return { passwordReset: true };
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async changePassword(
    @Body() body: ChangePasswordBody,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.user || !request.session) {
      throw new UnauthorizedException("Session invalide.");
    }
    const currentPassword = readCurrentPassword(body.currentPassword);
    const newPassword = readNewPassword(body.newPassword);
    try {
      await this.identityTokens.changePassword({
        userId: request.user.id,
        currentSessionId: request.session.id,
        currentPassword,
        newPassword,
      });
    } catch (error) {
      if (error instanceof InvalidCurrentPasswordError) {
        throw new UnauthorizedException("Mot de passe actuel invalide.");
      }
      if (error instanceof PasswordReuseError) {
        throw new BadRequestException(
          "Le nouveau mot de passe doit etre different.",
        );
      }
      throw error;
    }
    return { passwordChanged: true };
  }

  @Get("csrf")
  csrf(@Res({ passthrough: true }) response: Response) {
    const csrfToken = this.sessions.createCsrfToken();
    response.setHeader(
      "Set-Cookie",
      `${this.sessions.csrfCookieName}=${encodeURIComponent(csrfToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${this.sessions.csrfMaxAgeSeconds}${secureCookieAttribute()}`,
    );
    return { csrfToken };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException("Session invalide.");
    }
    return { user: presentUser(request.user) };
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.user || !request.session) {
      throw new UnauthorizedException("Session invalide.");
    }
    await this.sessions.revokeSession(request.session.id, request.user.id);
    this.clearAuthenticationCookies(response);
    return { loggedOut: true };
  }

  @Post("logout-all")
  @UseGuards(AuthGuard)
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.user) {
      throw new UnauthorizedException("Session invalide.");
    }
    await this.sessions.revokeAllSessions(request.user.id);
    this.clearAuthenticationCookies(response);
    return { loggedOut: true };
  }

  @Get("account/export")
  @UseGuards(AuthGuard)
  async exportAccount(
    @Req() request: AuthenticatedRequest,
    @Query("resource") resourceValue?: string,
    @Query("cursor") cursorValue?: string,
    @Query("limit") limitValue?: string,
  ) {
    if (!request.user) throw new UnauthorizedException("Session invalide.");
    return this.dataRights.exportPage({
      userId: request.user.id,
      resource: readExportResource(resourceValue),
      cursor: readExportCursor(cursorValue),
      limit: readExportLimit(limitValue),
    });
  }

  @Post("account/delete")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async deleteAccount(
    @Body() body: DeleteAccountBody,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.user) throw new UnauthorizedException("Session invalide.");
    const result = await this.dataRights.deleteAccount({
      userId: request.user.id,
      currentPassword: readCurrentPassword(body.currentPassword),
    });
    this.clearAuthenticationCookies(response);
    return result;
  }

  private attachSessionCookie(
    response: Response,
    session: CreatedSession,
  ): void {
    response.setHeader(
      "Set-Cookie",
      `${this.sessions.cookieName}=${encodeURIComponent(session.cookieValue)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${session.maxAgeSeconds}${secureCookieAttribute()}`,
    );
  }

  private clearAuthenticationCookies(response: Response): void {
    response.setHeader("Set-Cookie", [
      `${this.sessions.cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureCookieAttribute()}`,
      `${this.sessions.csrfCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureCookieAttribute()}`,
    ]);
  }
}

function presentUser(user: { id: string; email: string; role: string }) {
  return { id: user.id, email: user.email, role: user.role };
}

function verificationEmailAccepted(token: TestOnlyIdentityToken) {
  const response = { accepted: true, message: genericEmailDispatchMessage };
  return canExposeIdentityTokens() && token.testOnlyToken
    ? { ...response, testOnlyVerificationToken: token.testOnlyToken }
    : response;
}

function passwordResetEmailAccepted(token: TestOnlyIdentityToken) {
  const response = { accepted: true, message: genericEmailDispatchMessage };
  return canExposeIdentityTokens() && token.testOnlyToken
    ? { ...response, testOnlyPasswordResetToken: token.testOnlyToken }
    : response;
}

function assertConsent(body: RegistrationBody): void {
  if (
    body.consentAccepted !== true ||
    body.consentVersion !== CURRENT_LEGAL_CONSENT_VERSION
  ) {
    throw new BadRequestException(
      "Vous devez accepter les conditions et la politique applicables.",
    );
  }
}

function readRegistrationEmail(value: unknown): string {
  const email = normalizeOptionalEmail(value);
  if (!email) throw new BadRequestException(genericRegistrationMessage);
  return email;
}

function readOptionalEmail(value: unknown): string | null {
  return normalizeOptionalEmail(value);
}

function normalizeOptionalEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > maximumEmailLength) {
    return null;
  }
  try {
    const email = normalizeEmail(value);
    return email.length <= maximumEmailLength ? email : null;
  } catch {
    return null;
  }
}

function readNewPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < minimumPasswordLength ||
    value.length > maximumPasswordLength ||
    Buffer.byteLength(value, "utf8") > maximumPasswordBytes
  ) {
    throw new BadRequestException(
      `Le mot de passe doit contenir entre ${minimumPasswordLength} et ${maximumPasswordLength} caracteres.`,
    );
  }
  return value;
}

function readCurrentPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumPasswordLength ||
    Buffer.byteLength(value, "utf8") > maximumPasswordBytes
  ) {
    throw new UnauthorizedException("Mot de passe actuel invalide.");
  }
  return value;
}

function readOpaqueToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new BadRequestException(invalidIdentityTokenMessage);
  }
  return value;
}

function readMfaCode(value: unknown): string {
  if (typeof value !== "string" || !/^\d{6}$/.test(value)) {
    throw new UnauthorizedException({
      statusCode: HttpStatus.UNAUTHORIZED,
      code: "MFA_INVALID",
      message: "Code MFA invalide ou expire.",
    });
  }
  return value;
}

function readLoginInput(body: AuthBody): {
  email: string | null;
  password: string;
  valid: boolean;
} {
  const email = normalizeOptionalEmail(body.email);
  const passwordIsBounded =
    typeof body.password === "string" &&
    body.password.length > 0 &&
    body.password.length <= maximumPasswordLength &&
    Buffer.byteLength(body.password, "utf8") <= maximumPasswordBytes;

  return {
    email,
    password: passwordIsBounded
      ? (body.password as string)
      : invalidLoginPassword,
    valid: email !== null && passwordIsBounded,
  };
}

function secureCookieAttribute(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

function readExportResource(value: string | undefined): AccountExportResource {
  const resource = value ?? "profile";
  if (!accountExportResources.includes(resource as AccountExportResource)) {
    throw new BadRequestException("Ressource d'export invalide.");
  }
  return resource as AccountExportResource;
}

function readExportCursor(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  if (value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BadRequestException("Curseur d'export invalide.");
  }
  return value;
}

function readExportLimit(value: string | undefined): number {
  if (value === undefined || value === "") return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BadRequestException("Limite d'export invalide.");
  }
  return parsed;
}

async function padIdentityDispatchResponse(startedAt: number): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const configured = Number(process.env.AUTH_DISPATCH_MIN_RESPONSE_MS);
  const minimum =
    Number.isInteger(configured) && configured >= 100 && configured <= 1_000
      ? configured
      : 250;
  const remaining = minimum + randomInt(0, 51) - (Date.now() - startedAt);
  if (remaining > 0) await delay(remaining);
}
