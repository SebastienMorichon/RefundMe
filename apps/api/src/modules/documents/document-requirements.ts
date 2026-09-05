import { DocumentKind } from "@prisma/client";

export type DocumentRequirement = Readonly<{
  kind: DocumentKind;
  label: string;
  required: boolean;
}>;

const documentKinds = new Set<string>(Object.values(DocumentKind));

export function readDocumentRequirements(
  value: unknown,
): DocumentRequirement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const document = item as Record<string, unknown>;
    return typeof document.kind === "string" &&
      documentKinds.has(document.kind) &&
      typeof document.label === "string" &&
      typeof document.required === "boolean"
      ? [
          {
            kind: document.kind as DocumentKind,
            label: document.label,
            required: document.required,
          },
        ]
      : [];
  });
}

export function isDocumentRequirementSupplied(
  requiredKind: string,
  attachedKinds: ReadonlySet<string>,
): boolean {
  if (attachedKinds.has(requiredKind)) {
    return true;
  }

  return (
    (requiredKind === DocumentKind.PURCHASE_PROOF &&
      attachedKinds.has(DocumentKind.ORANGE_INVOICE)) ||
    (requiredKind === DocumentKind.ORANGE_INVOICE &&
      attachedKinds.has(DocumentKind.PURCHASE_PROOF))
  );
}

export function findMissingDocumentRequirements(
  value: unknown,
  attachedKinds: Iterable<string>,
): DocumentRequirement[] {
  const suppliedKinds = new Set(attachedKinds);
  return readDocumentRequirements(value).filter(
    (document) =>
      document.required &&
      !isDocumentRequirementSupplied(document.kind, suppliedKinds),
  );
}

export function documentRequirementShortName(kind: string): string {
  const names: Partial<Record<DocumentKind, string>> = {
    [DocumentKind.GAME_RULE_PDF]: "Règlement du jeu",
    [DocumentKind.ORANGE_INVOICE]: "Facture opérateur",
    [DocumentKind.PURCHASE_PROOF]: "Facture opérateur",
    [DocumentKind.IDENTITY_DOCUMENT]: "Pièce d'identité",
    [DocumentKind.BANK_DETAILS]: "RIB",
    [DocumentKind.TRAIN_TICKET]: "Billet de train",
    [DocumentKind.FLIGHT_TICKET]: "Billet d'avion",
    [DocumentKind.WARRANTY]: "Garantie",
    [DocumentKind.OTHER]: "Justificatif complémentaire",
  };

  return names[kind as DocumentKind] ?? "Document";
}
