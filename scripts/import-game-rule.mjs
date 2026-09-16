import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvironment();

const payload = readPayload(process.argv.slice(2));
const apiUrl = (
  process.env.RULE_AUTOMATION_API_URL?.trim() || requiredEnvironment("API_URL")
).replace(/\/+$/, "");
const token = requiredEnvironment("RULE_AUTOMATION_TOKEN");

const response = await fetch(`${apiUrl}/automation/rules`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(30_000),
});

const result = await readJson(response);
if (!response.ok) {
  const message =
    typeof result.message === "string"
      ? result.message
      : `Import refuse avec le statut HTTP ${response.status}.`;
  throw new Error(message);
}

const action = typeof result.action === "string" ? result.action : "unknown";
const rule = result.rule && typeof result.rule === "object" ? result.rule : {};
process.stdout.write(
  `${JSON.stringify({ action, ruleId: rule.id, status: rule.status })}\n`,
);

function readPayload(argumentsList) {
  const fileIndex = argumentsList.indexOf("--file");
  const filePath = fileIndex >= 0 ? argumentsList[fileIndex + 1] : undefined;
  const raw = filePath
    ? readFileSync(resolve(process.cwd(), filePath), "utf8")
    : readFileSync(0, "utf8");
  if (!raw.trim()) {
    throw new Error("Fournissez le JSON du reglement via --file ou stdin.");
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Le contenu du reglement doit etre un objet JSON.");
  }
  return parsed;
}

async function readJson(response) {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} est requis.`);
  return value;
}

function loadEnvironment() {
  const path = [".env.local", ".env"]
    .map((file) => resolve(process.cwd(), file))
    .find(existsSync);
  if (!path) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match?.[1] || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = (match[2] ?? "").replace(
      /^(?:"(.*)"|'(.*)')$/,
      "$1$2",
    );
  }
}
