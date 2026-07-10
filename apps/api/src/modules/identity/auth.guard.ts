import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { SessionService } from "./session.service";
import { AuthenticatedRequest, readCookie } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookie = readCookie(request.headers.cookie, this.sessions.cookieName);
    const user = this.sessions.readCookieValue(cookie);

    if (!user) {
      throw new UnauthorizedException("Session requise.");
    }

    request.user = user;
    return true;
  }
}
