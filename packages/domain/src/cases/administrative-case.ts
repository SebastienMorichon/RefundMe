import type { Money } from "../shared/money";

export const caseStatuses = [
  "DRAFT",
  "WAITING_FOR_USER_DOCUMENTS",
  "READY_TO_PAY",
  "PAID",
  "GENERATED",
  "PRINT_READY",
  "SENT",
  "REFUNDED",
  "REJECTED",
  "CANCELLED",
] as const;

export type CaseStatus = (typeof caseStatuses)[number];

export type AdministrativeCase = Readonly<{
  id: string;
  ownerId: string;
  status: CaseStatus;
  estimatedRecoverable: Money;
  serviceFee: Money;
  confidence?: number;
  gameRuleId?: string;
}>;

export function canRequestSensitiveDocuments(caseStatus: CaseStatus): boolean {
  return caseStatus === "WAITING_FOR_USER_DOCUMENTS" || caseStatus === "READY_TO_PAY";
}

