import { Body, Controller, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ContactService } from "./contact.service";

@Controller("contact")
export class ContactController {
  constructor(private readonly contacts: ContactService) {}

  @Post()
  async submit(@Body() body: unknown, @Req() request: Request) {
    await this.contacts.submit(
      body,
      request.ip || request.socket.remoteAddress || "unknown",
    );
    return { accepted: true };
  }
}
