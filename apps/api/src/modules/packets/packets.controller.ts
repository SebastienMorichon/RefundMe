import { Controller, Get, Param, Req, Res, StreamableFile, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { PacketsService } from "./packets.service";

@Controller("cases")
@UseGuards(AuthGuard)
export class PacketsController {
  constructor(private readonly packets: PacketsService) {}

  @Get(":id/dossier.pdf")
  async download(
    @Param("id") caseId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.user) {
      throw new UnauthorizedException("Session requise.");
    }

    const packet = await this.packets.generate(caseId, request.user.id);
    response.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `${packet.preview ? "inline" : "attachment"}; filename="dossier-lydoc-${caseId}.pdf"`,
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(packet.bytes);
  }
}
