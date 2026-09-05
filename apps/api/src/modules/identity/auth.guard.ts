import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { SessionService } from "./session.service";
import { AuthenticatedRequest, readCookie } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookie = readCookie(request.headers.cookie, this.sessions.cookieName);
    const session = await this.sessions.readCookieValue(cookie);

    if (!session) {
      throw new UnauthorizedException("Session requise.");
    }

    request.user = session.user;
    request.session = session;
    return true;
  }
}
