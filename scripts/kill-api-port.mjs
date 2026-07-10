import { execFileSync } from "node:child_process";

const port = "3001";

if (process.platform !== "win32") {
  process.exit(0);
}

const output = execFileSync("netstat", ["-ano"], {
  encoding: "utf8",
});

const pids = new Set(
  output
    .split(/\r?\n/)
    .filter((line) => line.includes(`:${port}`) && line.includes("LISTENING"))
    .map((line) => line.trim().split(/\s+/).at(-1))
    .filter(Boolean),
);

for (const pid of pids) {
  try {
    execFileSync("taskkill", ["/PID", pid, "/F"], {
      stdio: "ignore",
    });
  } catch {
    console.warn(`Could not stop process ${pid} on port ${port}. Run: taskkill /PID ${pid} /F`);
  }
}

if (pids.size > 0) {
  console.log(`Stopped stale API process on port ${port}.`);
}
