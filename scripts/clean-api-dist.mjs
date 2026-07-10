import { rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync(resolve("apps/api/dist"), {
  force: true,
  recursive: true,
});

console.log("API build cache cleaned.");
