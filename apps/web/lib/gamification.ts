import {
  caseProgress,
  isFinishedCase,
  type CaseSummary,
  type UploadedDocument,
} from "./client-data";

export type AchievementId =
  | "FIRST_ANALYSIS"
  | "FIRST_CASE"
  | "CASE_READY"
  | "FIRST_SEND"
  | "FIRST_REFUND"
  | "SECURE_ARCHIVE";

export type Achievement = {
  id: AchievementId;
  title: string;
  description: string;
  earned: boolean;
};

export type RecoveryStats = {
  detectedCents: number;
  activeCents: number;
  refundedCents: number;
  activeCases: number;
  readinessScore: number;
  level: string;
};

export function recoveryStats(cases: CaseSummary[]): RecoveryStats {
  const active = cases.filter((item) => !isFinishedCase(item));
  const detectedCents = cases
    .filter((item) => !["REJECTED", "CANCELLED"].includes(item.status))
    .reduce((total, item) => total + item.estimatedRecoverableCents, 0);
  const activeCents = active.reduce(
    (total, item) => total + item.estimatedRecoverableCents,
    0,
  );
  const refundedCents = cases
    .filter((item) => item.status === "REFUNDED")
    .reduce((total, item) => total + item.estimatedRecoverableCents, 0);
  const readinessScore =
    active.length > 0
      ? Math.max(...active.map(caseProgress))
      : cases.some((item) => item.status === "REFUNDED")
        ? 100
        : 0;

  return {
    detectedCents,
    activeCents,
    refundedCents,
    activeCases: active.length,
    readinessScore,
    level: recoveryLevel(cases),
  };
}

export function recoveryLevel(cases: CaseSummary[]): string {
  if (cases.some((item) => item.status === "REFUNDED")) return "Remboursé";
  if (
    cases.some(
      (item) =>
        item.fulfillmentMode ||
        ["PAID", "PRINT_READY", "SENT"].includes(item.status),
    )
  )
    return "Actif";
  if (cases.length > 0) return "En préparation";
  return "Découverte";
}

export function buildAchievements(
  documents: UploadedDocument[],
  cases: CaseSummary[],
): Achievement[] {
  const analyzedDocuments = documents.filter(
    (item) => item.status === "ANALYZED",
  );
  const hasReadyCase = cases.some(
    (item) =>
      item.fulfillmentMode !== null ||
      [
        "READY_TO_PAY",
        "GENERATED",
        "PAID",
        "PRINT_READY",
        "SENT",
        "REFUNDED",
      ].includes(item.status),
  );
  const hasSentCase = cases.some(
    (item) =>
      ["PAID", "PRINT_READY", "SENT", "REFUNDED"].includes(item.status) ||
      item.fulfillmentMode === "SELF_SERVICE",
  );

  return [
    {
      id: "FIRST_ANALYSIS",
      title: "Première facture analysée",
      description:
        "Une facture mobile a été analysée pour rechercher des SMS+.",
      earned: analyzedDocuments.length > 0,
    },
    {
      id: "FIRST_CASE",
      title: "Premier dossier SMS+",
      description: "Des SMS+ potentiellement remboursables ont été identifiés.",
      earned: cases.length > 0,
    },
    {
      id: "CASE_READY",
      title: "Dossier complet",
      description:
        "Les pièces exigées pour une demande de remboursement ont été réunies.",
      earned: hasReadyCase,
    },
    {
      id: "FIRST_SEND",
      title: "Premier envoi",
      description:
        "Un dossier de remboursement SMS+ est prêt à être transmis ou a été envoyé.",
      earned: hasSentCase,
    },
    {
      id: "FIRST_REFUND",
      title: "Premier remboursement",
      description: "La réception d’un remboursement de SMS+ a été confirmée.",
      earned: cases.some((item) => item.status === "REFUNDED"),
    },
    {
      id: "SECURE_ARCHIVE",
      title: "Justificatifs organisés",
      description:
        "Trois documents utiles à vos dossiers sont conservés dans l’espace sécurisé.",
      earned: documents.length >= 3,
    },
  ];
}

export function achievementProgress(achievements: Achievement[]): number {
  if (achievements.length === 0) return 0;
  return Math.round(
    (achievements.filter((item) => item.earned).length / achievements.length) *
      100,
  );
}

export function priorityCase(cases: CaseSummary[]): CaseSummary | null {
  const active = cases.filter((item) => !isFinishedCase(item));
  return (
    [...active].sort((left, right) => {
      const progressDifference = caseProgress(right) - caseProgress(left);
      if (progressDifference !== 0) return progressDifference;
      return (
        new Date(right.createdAt ?? 0).getTime() -
        new Date(left.createdAt ?? 0).getTime()
      );
    })[0] ??
    cases[0] ??
    null
  );
}
