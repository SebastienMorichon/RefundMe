import {
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return {
      notifications: await this.notifications.listForUser(this.userId(request)),
    };
  }

  @Patch(":id/read")
  async markRead(
    @Param("id") notificationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      read: await this.notifications.markRead(
        notificationId,
        this.userId(request),
      ),
    };
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user) throw new UnauthorizedException("Session requise.");
    return request.user.id;
  }
}
