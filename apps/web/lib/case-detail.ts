import { formatCents } from "./client-data";

export type RequiredDocument = {
  kind: string;
  label: string;
  required: boolean;
  supplied: boolean;
  documentId: string | null;
};

export type FulfillmentMode = "SELF_SERVICE" | "MANAGED_POSTAL";

export type PostalExpenseReimbursementReview = {
  available: boolean;
  requested: boolean;
  locked: boolean;
  selectedAt: string | null;
  appliesTo: "REFUND_REQUEST" | "RULE_COPY_REQUEST" | "BOTH" | "UNSPECIFIED";
  postage: {
    reimbursable: boolean;
    amountCents: number | null;
    basis: string;
  };
  printing: {
    reimbursable: boolean;
    centsPerPage: number | null;
    maxPages: number | null;
    basis: string;
  };
  claimLimit: {
    scope: "PER_REQUEST" | "PER_PARTICIPANT_PER_MONTH" | "PER_PARTICIPANT_PER_GAME" | "PER_HOUSEHOLD_PER_GAME" | "OTHER" | "UNSPECIFIED";
    strict: boolean;
    details: string;
  };
  requestInstructions: string;
  requiredProofs: string[];
  sourceReference: string;
};

export type CaseDetail = {
  id: string;
  status: string;
  fulfillmentMode: FulfillmentMode | null;
  estimatedRecoverableCents: number;
  serviceFeeCents: number;
  rule: { id: string; version: number; name: string; organizer: string };
  requiredDocuments: RequiredDocument[];
  missingDocuments: RequiredDocument[];
  customerProfile: { complete: boolean; missingFields: string[] };
  payment: { status: string; paidAt: string | null } | null;
  validation: { validatedAt: string } | null;
  review: {
    reimbursementRecipient: string;
    reimbursementAddress: string;
    reimbursementDeadline: string;
    detectedSmsCount: number;
    postalExpenseReimbursement: PostalExpenseReimbursementReview;
  };
  postalShipment: {
    provider: string;
    environment: string;
    product: string;
    status: string;
    postageCents: number;
    printingCents: number;
    totalCents: number;
    trackingNumber: string | null;
    errorMessage: string | null;
    quotedAt: string | null;
    submittedAt: string | null;
    deliveredAt: string | null;
    simulation: boolean;
  } | null;
};

export function documentName(
  document: Pick<RequiredDocument, "kind" | "label">,
): string {
  if (document.kind === "IDENTITY_DOCUMENT") return "Pièce d’identité";
  if (document.kind === "BANK_DETAILS") return "RIB";
  if (document.kind === "ORANGE_INVOICE") return "Facture opérateur";
  if (document.kind === "PURCHASE_PROOF") {
    return mentionsOperatorInvoice(document.label)
      ? "Facture opérateur"
      : "Preuve d’achat";
  }
  if (document.kind === "TRAIN_TICKET") return "Billet de train";
  if (document.kind === "FLIGHT_TICKET") return "Billet d’avion";
  if (document.kind === "WARRANTY") return "Garantie";
  if (document.kind === "OTHER" && mentionsPrepaidCard(document.label)) {
    return "Justificatif carte prépayée";
  }
  return "Justificatif complémentaire";
}

export function documentHelp(
  document: Pick<RequiredDocument, "kind" | "label" | "required">,
): string {
  if (!document.required && mentionsPrepaidCard(document.label)) {
    return "Uniquement si vous avez participé avec une carte prépayée.";
  }
  if (!document.required)
    return "À ajouter uniquement si votre situation le nécessite.";
  if (document.kind === "BANK_DETAILS") {
    return "Pour recevoir le remboursement.";
  }
  if (document.kind === "IDENTITY_DOCUMENT") {
    return "Pour confirmer l’identité du titulaire de la ligne.";
  }
  if (
    document.kind === "ORANGE_INVOICE" ||
    document.kind === "PURCHASE_PROOF"
  ) {
    return "Pour justifier les SMS facturés.";
  }
  return "Demandé par le règlement du jeu.";
}

export function documentUploadLabel(
  document: Pick<RequiredDocument, "kind" | "label">,
): string {
  if (document.kind === "IDENTITY_DOCUMENT")
    return "Ajouter ma pièce d’identité";
  if (document.kind === "BANK_DETAILS") return "Ajouter mon RIB";
  if (
    document.kind === "ORANGE_INVOICE" ||
    document.kind === "PURCHASE_PROOF"
  ) {
    return "Ajouter ma facture";
  }
  if (document.kind === "OTHER" && mentionsPrepaidCard(document.label)) {
    return "Ajouter un justificatif";
  }
  return `Ajouter ${documentName(document).toLocaleLowerCase("fr-FR")}`;
}

export function missingDocumentPrompt(
  document: Pick<RequiredDocument, "kind" | "label" | "documentId"> | undefined,
): string {
  if (!document) return "Ajoutez la pièce manquante pour continuer.";
  if (document.documentId) {
    return "Remplacez cet ancien document pour lui appliquer le filigrane requis.";
  }
  if (document.kind === "IDENTITY_DOCUMENT") {
    return "Ajoutez votre pièce d’identité pour continuer.";
  }
  if (document.kind === "BANK_DETAILS") {
    return "Ajoutez votre RIB pour continuer.";
  }
  if (
    document.kind === "ORANGE_INVOICE" ||
    document.kind === "PURCHASE_PROOF"
  ) {
    return "Ajoutez votre facture opérateur pour continuer.";
  }
  return `Ajoutez ${documentName(document).toLocaleLowerCase("fr-FR")} pour continuer.`;
}

function mentionsOperatorInvoice(label: string): boolean {
  const normalized = normalizeLabel(label);
  return normalized.includes("facture") || normalized.includes("operateur");
}

function mentionsPrepaidCard(label: string): boolean {
  return normalizeLabel(label).includes("carte prepayee");
}

function normalizeLabel(label: string): string {
  return label
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function journeyStep(administrativeCase: CaseDetail): number {
  if (administrativeCase.status === "REFUNDED") return 4;
  if (administrativeCase.fulfillmentMode) return 3;
  if (administrativeCase.validation) return 2;
  if (administrativeCase.status === "DRAFT") return 0;
  return 1;
}

export function caseNotice(
  administrativeCase: CaseDetail,
  managedPostalAvailable = true,
): {
  message: string;
  tone: "info" | "success" | "error";
} {
  if (administrativeCase.status === "REFUNDED")
    return {
      message: "Remboursement confirmé. Ce dossier est terminé.",
      tone: "success",
    };
  if (administrativeCase.status === "SENT")
    return {
      message: "Envoi confirmé. Votre demande est en attente de remboursement.",
      tone: "success",
    };
  if (administrativeCase.payment?.status === "PAID") {
    if (administrativeCase.postalShipment?.status === "DELIVERED")
      return {
        message: "Votre courrier a été distribué à l’organisateur.",
        tone: "success",
      };
    return {
      message:
        "Paiement confirmé. Lydoc prend en charge l’impression et l’envoi.",
      tone: "success",
    };
  }
  if (administrativeCase.fulfillmentMode === "SELF_SERVICE")
    return {
      message: "Votre dossier gratuit est prêt à être téléchargé.",
      tone: "success",
    };
  if (
    !managedPostalAvailable &&
    administrativeCase.fulfillmentMode === "MANAGED_POSTAL"
  )
    return {
      message:
        "L’envoi pris en charge est temporairement indisponible. Le téléchargement gratuit reste accessible.",
      tone: "info",
    };
  if (administrativeCase.postalShipment?.status === "QUOTED")
    return {
      message: "Votre devis est prêt. Vérifiez le total avant de payer.",
      tone: "success",
    };
  if (administrativeCase.fulfillmentMode === "MANAGED_POSTAL")
    return {
      message:
        "Vous avez choisi l’envoi pris en charge. Obtenez votre devis pour continuer.",
      tone: "info",
    };
  if (administrativeCase.validation)
    return {
      message:
        "Votre dossier est validé. Choisissez maintenant votre mode d’envoi.",
      tone: "success",
    };
  if (administrativeCase.status === "READY_TO_PAY")
    return {
      message:
        "Toutes les pièces sont réunies. Vérifiez les informations avant de continuer.",
      tone: "success",
    };
  if (administrativeCase.status === "DRAFT")
    return {
      message:
        "Le règlement a été identifié. Lancez la préparation pour voir les pièces utiles.",
      tone: "info",
    };
  return {
    message: "Ajoutez uniquement les pièces encore demandées.",
    tone: "info",
  };
}

export function trackingStages(administrativeCase: CaseDetail) {
  const shipment = administrativeCase.postalShipment!;
  const sent = [
    "SUBMITTED",
    "PRODUCED",
    "HANDED_OVER",
    "IN_TRANSIT",
    "DELIVERED",
  ].includes(shipment.status);
  const delivered = shipment.status === "DELIVERED";
  const refunded = administrativeCase.status === "REFUNDED";
  return [
    {
      label: "Dossier envoyé",
      detail: shipment.submittedAt
        ? `Transmis le ${formatDateTime(shipment.submittedAt)}`
        : "Transmission en cours",
      complete: sent,
      active: !sent,
    },
    {
      label: "Courrier distribué",
      detail: shipment.deliveredAt
        ? `Distribué le ${formatDateTime(shipment.deliveredAt)}`
        : "Lettre verte suivie",
      complete: delivered,
      active: sent && !delivered,
    },
    {
      label: "Traitement par l’organisateur",
      detail: "Délai indicatif selon le règlement",
      complete: refunded,
      active: delivered && !refunded,
    },
    {
      label: "Remboursement reçu",
      detail: refunded
        ? `${formatCents(administrativeCase.estimatedRecoverableCents)} confirmés`
        : "À confirmer lorsque le virement arrive",
      complete: refunded,
      active: false,
    },
  ];
}

export function trackingNextStep(administrativeCase: CaseDetail): string {
  if (administrativeCase.status === "REFUNDED")
    return "Aucune action nécessaire";
  const status = administrativeCase.postalShipment?.status;
  if (status === "DELIVERED") return "Attendre la réponse de l’organisateur";
  if (
    ["SUBMITTED", "PRODUCED", "HANDED_OVER", "IN_TRANSIT"].includes(
      status ?? "",
    )
  )
    return "Suivre l’acheminement du courrier";
  return "Lydoc prépare votre envoi";
}

export function formatPostalStatus(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Préparation du devis",
    QUOTED: "Devis prêt",
    SUBMITTED: "Dossier transmis à l’imprimeur",
    PRODUCED: "Courrier imprimé et mis sous pli",
    HANDED_OVER: "Courrier remis à La Poste",
    IN_TRANSIT: "Courrier en cours d’acheminement",
    DELIVERED: "Courrier distribué à l’organisateur",
    FAILED: "Une action est nécessaire",
    CANCELLED: "Envoi annulé",
  };
  return labels[status] ?? status;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(
    new Date(value),
  );
}

export function readCaseDetail(value: unknown): CaseDetail | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rule = item.rule as Record<string, unknown> | undefined;
  const customerProfile = item.customerProfile as
    Record<string, unknown> | undefined;
  const review = item.review as Record<string, unknown> | undefined;
  if (
    typeof item.id !== "string" ||
    typeof item.status !== "string" ||
    typeof item.estimatedRecoverableCents !== "number" ||
    typeof item.serviceFeeCents !== "number" ||
    !rule ||
    typeof rule.id !== "string" ||
    typeof rule.version !== "number" ||
    typeof rule.name !== "string" ||
    typeof rule.organizer !== "string" ||
    !Array.isArray(item.requiredDocuments) ||
    !Array.isArray(item.missingDocuments) ||
    !customerProfile ||
    typeof customerProfile.complete !== "boolean" ||
    !Array.isArray(customerProfile.missingFields) ||
    !review ||
    typeof review.reimbursementRecipient !== "string" ||
    typeof review.reimbursementAddress !== "string" ||
    typeof review.reimbursementDeadline !== "string" ||
    typeof review.detectedSmsCount !== "number"
  )
    return null;

  const parseDocument = (raw: unknown): RequiredDocument | null => {
    if (!raw || typeof raw !== "object") return null;
    const document = raw as Record<string, unknown>;
    return typeof document.kind === "string" &&
      typeof document.label === "string" &&
      typeof document.required === "boolean" &&
      typeof document.supplied === "boolean"
      ? {
          kind: document.kind,
          label: document.label,
          required: document.required,
          supplied: document.supplied,
          documentId:
            typeof document.documentId === "string"
              ? document.documentId
              : null,
        }
      : null;
  };
  const payment =
    item.payment && typeof item.payment === "object"
      ? (item.payment as Record<string, unknown>)
      : null;
  const validation =
    item.validation && typeof item.validation === "object"
      ? (item.validation as Record<string, unknown>)
      : null;
  const postalShipment =
    item.postalShipment && typeof item.postalShipment === "object"
      ? (item.postalShipment as Record<string, unknown>)
      : null;

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
    rule: {
      id: rule.id,
      version: rule.version,
      name: rule.name,
      organizer: rule.organizer,
    },
    requiredDocuments: item.requiredDocuments.flatMap((raw) => {
      const parsed = parseDocument(raw);
      return parsed ? [parsed] : [];
    }),
    missingDocuments: item.missingDocuments.flatMap((raw) => {
      const parsed = parseDocument(raw);
      return parsed ? [parsed] : [];
    }),
    customerProfile: {
      complete: customerProfile.complete,
      missingFields: customerProfile.missingFields.filter(
        (field): field is string => typeof field === "string",
      ),
    },
    payment:
      payment && typeof payment.status === "string"
        ? {
            status: payment.status,
            paidAt: typeof payment.paidAt === "string" ? payment.paidAt : null,
          }
        : null,
    validation:
      validation && typeof validation.validatedAt === "string"
        ? { validatedAt: validation.validatedAt }
        : null,
    review: {
      reimbursementRecipient: review.reimbursementRecipient,
      reimbursementAddress: review.reimbursementAddress,
      reimbursementDeadline: review.reimbursementDeadline,
      detectedSmsCount: review.detectedSmsCount,
      postalExpenseReimbursement: readPostalExpenseReimbursementReview(
        review.postalExpenseReimbursement,
      ),
    },
    postalShipment: readPostalShipment(postalShipment),
  };
}

function readPostalExpenseReimbursementReview(
  value: unknown,
): PostalExpenseReimbursementReview {
  const input = readRecord(value);
  const postage = readRecord(input.postage);
  const printing = readRecord(input.printing);
  const claimLimit = readRecord(input.claimLimit);
  return {
    available: input.available === true,
    requested: input.requested === true,
    locked: input.locked === true,
    selectedAt: typeof input.selectedAt === "string" ? input.selectedAt : null,
    appliesTo: readPostalAppliesTo(input.appliesTo),
    postage: {
      reimbursable: postage.reimbursable === true,
      amountCents: readOptionalInteger(postage.amountCents),
      basis: typeof postage.basis === "string" ? postage.basis : "",
    },
    printing: {
      reimbursable: printing.reimbursable === true,
      centsPerPage: readOptionalInteger(printing.centsPerPage),
      maxPages: readOptionalInteger(printing.maxPages),
      basis: typeof printing.basis === "string" ? printing.basis : "",
    },
    claimLimit: {
      scope: readPostalClaimScope(claimLimit.scope),
      strict: claimLimit.strict === true,
      details: typeof claimLimit.details === "string" ? claimLimit.details : "",
    },
    requestInstructions:
      typeof input.requestInstructions === "string"
        ? input.requestInstructions
        : "",
    requiredProofs: Array.isArray(input.requiredProofs)
      ? input.requiredProofs.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    sourceReference:
      typeof input.sourceReference === "string" ? input.sourceReference : "",
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function readPostalAppliesTo(
  value: unknown,
): PostalExpenseReimbursementReview["appliesTo"] {
  return value === "REFUND_REQUEST" ||
    value === "RULE_COPY_REQUEST" ||
    value === "BOTH"
    ? value
    : "UNSPECIFIED";
}

function readPostalClaimScope(
  value: unknown,
): PostalExpenseReimbursementReview["claimLimit"]["scope"] {
  return value === "PER_REQUEST" ||
    value === "PER_PARTICIPANT_PER_MONTH" ||
    value === "PER_PARTICIPANT_PER_GAME" ||
    value === "PER_HOUSEHOLD_PER_GAME" ||
    value === "OTHER"
    ? value
    : "UNSPECIFIED";
}

function readPostalShipment(
  value: Record<string, unknown> | null,
): CaseDetail["postalShipment"] {
  if (!value) return null;
  if (
    typeof value.provider !== "string" ||
    typeof value.environment !== "string" ||
    typeof value.product !== "string" ||
    typeof value.status !== "string" ||
    typeof value.postageCents !== "number" ||
    typeof value.printingCents !== "number" ||
    typeof value.totalCents !== "number" ||
    typeof value.simulation !== "boolean"
  )
    return null;
  return {
    provider: value.provider,
    environment: value.environment,
    product: value.product,
    status: value.status,
    postageCents: value.postageCents,
    printingCents: value.printingCents,
    totalCents: value.totalCents,
    trackingNumber:
      typeof value.trackingNumber === "string" ? value.trackingNumber : null,
    errorMessage:
      typeof value.errorMessage === "string" ? value.errorMessage : null,
    quotedAt: typeof value.quotedAt === "string" ? value.quotedAt : null,
    submittedAt:
      typeof value.submittedAt === "string" ? value.submittedAt : null,
    deliveredAt:
      typeof value.deliveredAt === "string" ? value.deliveredAt : null,
    simulation: value.simulation,
  };
}
