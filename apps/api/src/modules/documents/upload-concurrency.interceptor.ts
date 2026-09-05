import {
  HttpException,
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Response } from "express";
import type { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import type { AuthenticatedRequest } from "../identity/auth.types";

/**
 * Admits uploads only after AuthGuard has authenticated the request. This
 * prevents anonymous slow bodies from reserving the expensive CDR slots.
 */
@Injectable()
export class UploadConcurrencyInterceptor implements NestInterceptor {
  private readonly globalLimit = readBoundedInteger(
    "DOCUMENT_UPLOAD_CONCURRENCY_GLOBAL",
    4,
    1,
    32,
  );
  private readonly accountLimit = readBoundedInteger(
    "DOCUMENT_UPLOAD_CONCURRENCY_ACCOUNT",
    2,
    1,
    8,
  );
  private activeGlobal = 0;
  private readonly activeByAccount = new Map<string, number>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const accountId = request.user?.id;
    if (!accountId) {
      throw new HttpException("Session invalide.", HttpStatus.UNAUTHORIZED);
    }

    const activeForAccount = this.activeByAccount.get(accountId) ?? 0;
    if (
      this.activeGlobal >= this.globalLimit ||
      activeForAccount >= this.accountLimit
    ) {
      response.setHeader("Retry-After", "5");
      throw new HttpException(
        "Trop de depots simultanes. Reessayez dans quelques instants.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.activeGlobal += 1;
    this.activeByAccount.set(accountId, activeForAccount + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.activeGlobal = Math.max(0, this.activeGlobal - 1);
      const remaining = (this.activeByAccount.get(accountId) ?? 1) - 1;
      if (remaining <= 0) this.activeByAccount.delete(accountId);
      else this.activeByAccount.set(accountId, remaining);
    };

    try {
      return next.handle().pipe(finalize(release));
    } catch (error) {
      release();
      throw error;
    }
  }
}

function readBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}
