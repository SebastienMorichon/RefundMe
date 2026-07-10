import { rmSync } from "node:fs";
import { resolve } from "node:path";

const paths = [
  "apps/web/.next",
  "apps/web/tsconfig.tsbuildinfo",
];

for (const path of paths) {
  rmSync(resolve(path), {
    force: true,
    recursive: true,
  });
}

console.log("Next.js development cache cleaned.");
