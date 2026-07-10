import type { Money } from "../shared/money";

export const ruleStatuses = [
  "DRAFT",
  "AI_EXTRACTED",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
] as const;

export type RuleStatus = (typeof ruleStatuses)[number];

export type RequiredDocument = Readonly<{
  kind: string;
  label: string;
  required: boolean;
}>;

export type GameRule = Readonly<{
  id: string;
  organizerId: string;
  status: RuleStatus;
  name: string;
  version: number;
  reimbursement: Money;
  requiredDocuments: RequiredDocument[];
  validFrom?: Date;
  validUntil?: Date;
}>;

export function assertRuleCanBeUsed(rule: GameRule): void {
  if (rule.status !== "APPROVED") {
    throw new Error("Only approved rules can be used to create a case.");
  }
}

