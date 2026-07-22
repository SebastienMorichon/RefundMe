export type User = { id: string; email: string; role: string };

export type UploadedDocument = {
  id: string;
  kind: string;
  status: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  encrypted: boolean;
};

export type CaseSummary = {
  id: string;
  status: string;
  fulfillmentMode: "SELF_SERVICE" | "MANAGED_POSTAL" | null;
  estimatedRecoverableCents: number;
  serviceFeeCents: number;
  confidence: number | null;
  createdAt: string | null;
  rule: { id: string; name: string; organizer: string } | null;
};

export const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function readJson(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function errorMessage(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof payload.message === "string") return payload.message;
  if (
    Array.isArray(payload.message) &&
    payload.message.every((item) => typeof item === "string")
  ) {
    return payload.message.join(" ");
  }
  return fallback;
}

export function readUser(value: unknown): User | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.role === "string"
    ? { id: user.id, email: user.email, role: user.role }
    : null;
}

export function readDocument(value: unknown): UploadedDocument | null {
  if (!value || typeof value !== "object") return null;
  const document = value as Record<string, unknown>;
  return typeof document.id === "string" &&
    typeof document.kind === "string" &&
    typeof document.status === "string" &&
    typeof document.originalName === "string" &&
    typeof document.mimeType === "string" &&
    typeof document.sizeBytes === "number" &&
    typeof document.encrypted === "boolean"
    ? {
        id: document.id,
        kind: document.kind,
        status: document.status,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        encrypted: document.encrypted,
      }
    : null;
}

export function readCaseSummary(value: unknown): CaseSummary | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rawRule = item.rule;
  const rule =
    rawRule && typeof rawRule === "object"
      ? (rawRule as Record<string, unknown>)
      : null;
  if (
    typeof item.id !== "string" ||
    typeof item.status !== "string" ||
    typeof item.estimatedRecoverableCents !== "number" ||
    typeof item.serviceFeeCents !== "number" ||
    (item.confidence !== null &&
      item.confidence !== undefined &&
      typeof item.confidence !== "number") ||
    (rule &&
      (typeof rule.id !== "string" ||
        typeof rule.name !== "string" ||
        typeof rule.organizer !== "string"))
  )
    return null;

  return {
    id: item.id,
    status: item.status,
    fulfillmentMode:
      item.fulfillmentMode === "SELF_SERVICE" ||
      item.fulfillmentMode === "MANAGED_POSTAL"
        ? item.fulfillmentMode
        : null,
    estimatedRecoverableCents: item.estimatedRecoverableCents,
    serviceFeeCents: item.serviceFeeCents,
    confidence: typeof item.confidence === "number" ? item.confidence : null,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
    rule: rule
      ? {
          id: rule.id as string,
          name: rule.name as string,
          organizer: rule.organizer as string,
        }
      : null,
  };
}

export function readList<T>(
  value: unknown,
  parser: (item: unknown) => T | null,
): T[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = parser(item);
        return parsed ? [parsed] : [];
      })
    : [];
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string")
        return reject(new Error("Impossible de lire le document."));
      const separator = reader.result.indexOf(",");
      if (separator === -1)
        return reject(new Error("Impossible de préparer le document."));
      resolve(reader.result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error("Impossible de lire le document."));
    reader.readAsDataURL(file);
  });
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} Ko`
    : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function formatDocumentKind(kind: string): string {
  const labels: Record<string, string> = {
    ORANGE_INVOICE: "Facture opérateur",
    IDENTITY_DOCUMENT: "Pièce d’identité",
    BANK_DETAILS: "RIB",
    TRAIN_TICKET: "Billet de train",
    FLIGHT_TICKET: "Billet d’avion",
    PURCHASE_PROOF: "Justificatif d’achat",
    WARRANTY: "Garantie",
  };
  return labels[kind] ?? "Document";
}

export function isFinishedCase(item: CaseSummary): boolean {
  return ["REFUNDED", "REJECTED", "CANCELLED"].includes(item.status);
}

export function caseJourneyStep(item: CaseSummary): number {
  if (["REFUNDED"].includes(item.status)) return 4;
  if (item.fulfillmentMode) return 3;
  if (
    ["READY_TO_PAY", "GENERATED", "PAID", "PRINT_READY", "SENT"].includes(
      item.status,
    )
  )
    return 2;
  if (item.status === "WAITING_FOR_USER_DOCUMENTS") return 1;
  return 0;
}

export function caseProgress(item: CaseSummary): number {
  return [25, 50, 75, 100, 100][caseJourneyStep(item)] ?? 25;
}

export function nextCaseAction(item: CaseSummary): string {
  if (item.status === "DRAFT") return "Préparer le dossier";
  if (item.status === "WAITING_FOR_USER_DOCUMENTS") return "Ajouter les pièces";
  if (item.status === "READY_TO_PAY" && !item.fulfillmentMode)
    return "Vérifier ou choisir";
  if (item.fulfillmentMode === "SELF_SERVICE") return "Télécharger le dossier";
  if (["PAID", "PRINT_READY", "SENT"].includes(item.status))
    return "Suivre l’envoi";
  if (item.status === "REFUNDED") return "Voir le remboursement";
  return "Ouvrir le dossier";
}

export function formatDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}
