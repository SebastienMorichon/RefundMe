import { createHash } from "node:crypto";
import { Controller, Get, HttpStatus, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RulesService } from "./rules.service";

const catalogCacheSeconds = 60;

type CatalogPayload = Readonly<{
  channels: Awaited<ReturnType<RulesService["catalog"]>>;
}>;

type CatalogCacheEntry = Readonly<{
  expiresAt: number;
  etag: string;
  payload: CatalogPayload;
}>;

@Controller("games")
export class GamesController {
  private catalogCache: CatalogCacheEntry | undefined;
  private catalogRefresh: Promise<CatalogCacheEntry> | undefined;

  constructor(private readonly rules: RulesService) {}

  @Get("catalog")
  async catalog(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CatalogPayload | undefined> {
    const entry = await this.readCatalog();
    response.setHeader(
      "Cache-Control",
      `public, max-age=${catalogCacheSeconds}, s-maxage=${catalogCacheSeconds}, stale-while-revalidate=30`,
    );
    response.setHeader("ETag", entry.etag);
    response.setHeader("Vary", "Origin");
    response.removeHeader("Pragma");

    if (matchesEntityTag(request.header("if-none-match"), entry.etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return entry.payload;
  }

  private async readCatalog(): Promise<CatalogCacheEntry> {
    const now = Date.now();
    if (this.catalogCache && this.catalogCache.expiresAt > now) {
      return this.catalogCache;
    }
    if (this.catalogRefresh) return this.catalogRefresh;

    this.catalogRefresh = this.rules
      .catalog()
      .then((channels) => {
        const payload = { channels };
        const etag = `"${createHash("sha256")
          .update(JSON.stringify(payload), "utf8")
          .digest("base64url")}"`;
        const entry = {
          expiresAt: Date.now() + catalogCacheSeconds * 1_000,
          etag,
          payload,
        };
        this.catalogCache = entry;
        return entry;
      })
      .finally(() => {
        this.catalogRefresh = undefined;
      });
    return this.catalogRefresh;
  }
}

export function matchesEntityTag(
  ifNoneMatch: string | undefined,
  currentEtag: string,
): boolean {
  if (!ifNoneMatch) return false;
  const normalizedCurrent = currentEtag.replace(/^W\//, "");
  return ifNoneMatch.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === normalizedCurrent;
  });
}
