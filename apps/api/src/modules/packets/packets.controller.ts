import { Controller, Get, Param, Req, Res, StreamableFile, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { DocumentLifecycleService } from "../documents/document-lifecycle.service";
import { PacketsService } from "./packets.service";

@Controller("cases")
@UseGuards(AuthGuard)
export class PacketsController {
  constructor(
    private readonly packets: PacketsService,
    private readonly documentLifecycle: DocumentLifecycleService,
  ) {}

  @Get(":id/dossier.pdf")
  async download(
    @Param("id") caseId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.user) {
      throw new UnauthorizedException("Session requise.");
    }

    const ownerId = request.user.id;
    const packet = await this.packets.generate(caseId, ownerId);
    response.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `${packet.preview ? "inline" : "attachment"}; filename="dossier-lydoc-${caseId}.pdf"`,
      "Cache-Control": "private, no-store",
    });
    if (!packet.preview) {
      response.once("finish", () => {
        void this.documentLifecycle
          .purgeSelfServiceCaseAfterDownload(caseId, ownerId)
          .catch((error: unknown) => {
            process.stderr.write(
              `${JSON.stringify({
                level: "error",
                type: "case_download_purge_failed",
                caseId,
                error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
                timestamp: new Date().toISOString(),
              })}\n`,
            );
          });
      });
    }
    return new StreamableFile(packet.bytes);
  }
}
