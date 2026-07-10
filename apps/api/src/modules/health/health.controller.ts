import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  readHealth() {
    return {
      status: "ok",
      service: "lydoc-api",
    };
  }
}

