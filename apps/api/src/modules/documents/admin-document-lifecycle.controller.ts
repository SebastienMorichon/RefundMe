import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../identity/admin.guard";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { DocumentLifecycleService } from "./document-lifecycle.service";

@Controller("admin/documents/lifecycle")
@UseGuards(AuthGuard, AdminGuard)
export class AdminDocumentLifecycleController {
  constructor(private readonly lifecycle: DocumentLifecycleService) {}

  @Post("watermark-migration")
  async migrate(
    @Body() body: { dryRun?: boolean; limit?: number },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.migrateSensitiveDocuments({
      actorId: request.user!.id,
      dryRun: body.dryRun !== false,
      limit: body.limit ?? 25,
    });
  }

  @Post("retention")
  async retention(
    @Body() body: { dryRun?: boolean },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.runRetention({
      actorId: request.user!.id,
      dryRun: body.dryRun !== false,
    });
  }
}
