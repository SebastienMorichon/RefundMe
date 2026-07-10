import { rmSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const paths = [
  "apps/api/dist",
  "packages/application/dist",
  "packages/infrastructure/dist",
];

for (const path of paths) {
  rmSync(resolve(path), {
    force: true,
    recursive: true,
  });
}

for (const path of [
  "packages/domain/src",
  "packages/application/src",
  "packages/infrastructure/src",
]) {
  removeGeneratedArtifacts(resolve(path));
}

console.log("Build cache cleaned.");

function removeGeneratedArtifacts(directory) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      removeGeneratedArtifacts(fullPath);
      continue;
    }

    if (entry.endsWith(".d.ts") || entry.endsWith(".js.map") || extname(entry) === ".js") {
      rmSync(fullPath, { force: true });
    }
  }
}
