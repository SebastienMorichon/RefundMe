import { execFileSync } from "node:child_process";

const ports = ["3000", "3001"];

if (process.platform !== "win32") {
  process.exit(0);
}

const output = execFileSync("netstat", ["-ano"], {
  encoding: "utf8",
});

const pids = new Map();

for (const line of output.split(/\r?\n/)) {
  if (!line.includes("LISTENING")) {
    continue;
  }

  const port = ports.find((candidate) => line.includes(`:${candidate}`));

  if (!port) {
    continue;
  }

  const pid = line.trim().split(/\s+/).at(-1);

  if (pid) {
    pids.set(pid, port);
  }
}

for (const [pid, port] of pids.entries()) {
  try {
    execFileSync("taskkill", ["/PID", pid, "/F"], {
      stdio: "ignore",
    });
    console.log(`Stopped stale dev process on port ${port}.`);
  } catch {
    console.warn(`Could not stop process ${pid} on port ${port}. Run: taskkill /PID ${pid} /F`);
  }
}
