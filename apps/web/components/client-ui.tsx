import {
  AlertCircle,
  Check,
  CheckCircle2,
  Info,
  LoaderCircle,
} from "lucide-react";
import type { ReactNode } from "react";

export type NoticeTone = "info" | "success" | "error";

export function Notice({
  tone = "info",
  children,
  busy = false,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  busy?: boolean;
}) {
  const styles =
    tone === "success"
      ? "border-[#b9dfcd] bg-[#f2fbf6] text-[#176b49]"
      : tone === "error"
        ? "border-[#f0c5bb] bg-[#fff5f2] text-[#934430]"
        : "border-[#c9ddd3] bg-[#f3f8f5] text-[#315f4c]";
  const Icon = busy
    ? LoaderCircle
    : tone === "success"
      ? CheckCircle2
      : tone === "error"
        ? AlertCircle
        : Info;

  return (
    <div
      className={`flex items-start gap-3 rounded-md border px-4 py-3.5 text-sm leading-6 ${styles}`}
      role="status"
    >
      <Icon
        size={18}
        className={`mt-0.5 shrink-0 ${busy ? "animate-spin" : ""}`}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function JourneySteps({ current }: { current: number }) {
  const steps = [
    "Détection",
    "Préparation",
    "Validation",
    "Envoi",
    "Remboursement",
  ];

  return (
    <ol className="grid grid-cols-5" aria-label="Avancement du dossier">
      {steps.map((label, index) => {
        const completed = index < current;
        const active = index === current;
        return (
          <li key={label} className="min-w-0">
            <div className="flex items-center">
              <span
                className={`h-px flex-1 ${index === 0 ? "bg-transparent" : index <= current ? "bg-[#087a55]" : "bg-[#d9e2dd]"}`}
              />
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-extrabold ${
                  completed
                    ? "border-[#087a55] bg-[#087a55] text-white"
                    : active
                      ? "border-[#087a55] bg-white text-[#087a55]"
                      : "border-[#cbd5d0] bg-white text-[#7a8780]"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {completed ? <Check size={15} strokeWidth={3} /> : index + 1}
              </span>
              <span
                className={`h-px flex-1 ${index === steps.length - 1 ? "bg-transparent" : index < current ? "bg-[#087a55]" : "bg-[#d9e2dd]"}`}
              />
            </div>
            <p
              className={`mt-2 truncate text-center text-[10px] font-bold sm:text-xs ${completed ? "text-[#087a55]" : active ? "text-[#087a55]" : "text-[#7a8780]"}`}
            >
              {label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function LoadingState({ label = "Chargement..." }: { label?: string }) {
  return (
    <div className="grid min-h-[55vh] place-items-center px-5">
      <div className="text-center">
        <LoaderCircle
          className="mx-auto animate-spin text-[#087a55]"
          size={28}
        />
        <p className="mt-4 text-sm font-semibold text-[#66736d]">{label}</p>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const success = [
    "ANALYZED",
    "READY_TO_PAY",
    "GENERATED",
    "PAID",
    "PRINT_READY",
    "SENT",
    "REFUNDED",
    "VALID",
  ].includes(status);
  const error = ["FAILED", "REJECTED", "CANCELLED"].includes(status);
  const label = formatStatus(status);

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-extrabold ${
        success
          ? "bg-[#e8f6ef] text-[#087a55]"
          : error
            ? "bg-[#fff0ec] text-[#b14b35]"
            : "bg-[#fff4e7] text-[#9a5a17]"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${success ? "bg-[#087a55]" : error ? "bg-[#d9573f]" : "bg-[#d47a22]"}`}
      />
      {label}
    </span>
  );
}

export function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    UPLOADED: "Déposée",
    OCR_PENDING: "Lecture en cours",
    OCR_DONE: "Texte extrait",
    ANALYSIS_PENDING: "Analyse en cours",
    ANALYZED: "Analysée",
    FAILED: "Échec",
    DRAFT: "À préparer",
    WAITING_FOR_USER_DOCUMENTS: "Pièces attendues",
    READY_TO_PAY: "Dossier complet",
    GENERATED: "Prêt à envoyer",
    PAID: "Payé",
    PRINT_READY: "En préparation",
    SUBMITTING: "Transmission en cours",
    SENT: "Envoyé",
    REFUNDED: "Remboursé",
    REJECTED: "Refusé",
    CANCELLED: "Annulé",
    NOT_REQUIRED: "Non requis",
    PENDING: "Contrôle en cours",
    VALID: "Validé",
    NEEDS_REVIEW: "À vérifier",
  };
  return labels[status] ?? status;
}
