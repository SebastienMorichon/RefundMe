export const documentKinds = [
  "GAME_RULE_PDF",
  "ORANGE_INVOICE",
  "IDENTITY_DOCUMENT",
  "BANK_DETAILS",
  "TRAIN_TICKET",
  "FLIGHT_TICKET",
  "PURCHASE_PROOF",
  "WARRANTY",
  "OTHER",
] as const;

export type DocumentKind = (typeof documentKinds)[number];

export const documentStatuses = [
  "UPLOADED",
  "OCR_PENDING",
  "OCR_DONE",
  "ANALYSIS_PENDING",
  "ANALYZED",
  "FAILED",
] as const;

export type DocumentStatus = (typeof documentStatuses)[number];

export type StoredDocument = Readonly<{
  id: string;
  ownerId?: string;
  kind: DocumentKind;
  status: DocumentStatus;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageBucket: string;
  checksumSha256: string;
  storageKey: string;
  encrypted: true;
}>;
