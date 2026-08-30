import { DocumentKind } from "@prisma/client";

const aiEligibleDocumentKinds = new Set<DocumentKind>([
  DocumentKind.ORANGE_INVOICE,
  DocumentKind.GAME_RULE_PDF,
]);

export function canSendDocumentToAi(kind: DocumentKind): boolean {
  return aiEligibleDocumentKinds.has(kind);
}

export function requireDocumentEligibleForAi(kind: DocumentKind): void {
  if (!canSendDocumentToAi(kind)) {
    throw new Error("Ce type de document ne peut pas être transmis à une IA.");
  }
}
