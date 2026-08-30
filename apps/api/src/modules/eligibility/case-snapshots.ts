import {
  readPostalExpenseReimbursement,
  type PostalExpenseReimbursement,
} from "../rules/postal-expense-reimbursement";

export type CaseRuleSnapshot = Readonly<{
  ruleId: string;
  version: number;
  name: string;
  organizerName: string;
  reimbursementCents: number;
  requiredDocuments: unknown;
  constraints: Record<string, unknown>;
  validFrom: string | null;
  validUntil: string | null;
  reviewedAt: string | null;
  capturedAt: string;
}>;

export type CaseCustomerSnapshot = Readonly<{
  email: string;
  firstName: string;
  lastName: string;
  postalAddress: string;
  postalCode: string;
  city: string;
  country: string;
  phoneNumber: string;
  operatorCustomerReference: string;
}>;

export type CaseValidationSnapshot = Readonly<{
  version: 1;
  confirmedAt: string;
  rule: CaseRuleSnapshot;
  customer: CaseCustomerSnapshot;
  documents: Array<{ id: string; kind: string; originalName: string }>;
  estimatedRecoverableCents: number;
  serviceFeeCents: number;
  postalExpenseClaim?: Readonly<{
    requested: boolean;
    selectedAt: string | null;
    terms: PostalExpenseReimbursement;
  }>;
}>;

export function createCaseRuleSnapshot(rule: {
  id: string;
  version: number;
  name: string;
  reimbursementCents: number;
  requiredDocuments: unknown;
  constraintsJson: unknown;
  validFrom: Date | null;
  validUntil: Date | null;
  reviewedAt: Date | null;
  organizer: { name: string };
}, capturedAt = new Date()): CaseRuleSnapshot {
  return {
    ruleId: rule.id,
    version: rule.version,
    name: rule.name,
    organizerName: rule.organizer.name,
    reimbursementCents: rule.reimbursementCents,
    requiredDocuments: toSerializable(rule.requiredDocuments),
    constraints: cloneRecord(rule.constraintsJson),
    validFrom: rule.validFrom?.toISOString() ?? null,
    validUntil: rule.validUntil?.toISOString() ?? null,
    reviewedAt: rule.reviewedAt?.toISOString() ?? null,
    capturedAt: capturedAt.toISOString(),
  };
}

export function readCaseRuleSnapshot(value: unknown): CaseRuleSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.ruleId !== "string" ||
    typeof snapshot.version !== "number" ||
    typeof snapshot.name !== "string" ||
    typeof snapshot.organizerName !== "string" ||
    typeof snapshot.reimbursementCents !== "number" ||
    !snapshot.constraints || typeof snapshot.constraints !== "object" || Array.isArray(snapshot.constraints) ||
    typeof snapshot.capturedAt !== "string"
  ) return null;

  return {
    ruleId: snapshot.ruleId,
    version: snapshot.version,
    name: snapshot.name,
    organizerName: snapshot.organizerName,
    reimbursementCents: snapshot.reimbursementCents,
    requiredDocuments: snapshot.requiredDocuments ?? [],
    constraints: snapshot.constraints as Record<string, unknown>,
    validFrom: typeof snapshot.validFrom === "string" ? snapshot.validFrom : null,
    validUntil: typeof snapshot.validUntil === "string" ? snapshot.validUntil : null,
    reviewedAt: typeof snapshot.reviewedAt === "string" ? snapshot.reviewedAt : null,
    capturedAt: snapshot.capturedAt,
  };
}

export function readRuleSnapshotFromCompliance(value: unknown): CaseRuleSnapshot | null {
  return readCaseRuleSnapshot(readObject(value).ruleSnapshot);
}

export function addRuleSnapshotToCompliance(value: unknown, ruleSnapshot: CaseRuleSnapshot): Record<string, unknown> {
  return { ...readObject(value), ruleSnapshot };
}

export function createCustomerSnapshot(customer: {
  email: string;
  firstName: string | null;
  lastName: string | null;
  postalAddress: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phoneNumber: string | null;
  operatorCustomerReference: string | null;
}): CaseCustomerSnapshot {
  return {
    email: customer.email,
    firstName: customer.firstName ?? "",
    lastName: customer.lastName ?? "",
    postalAddress: customer.postalAddress ?? "",
    postalCode: customer.postalCode ?? "",
    city: customer.city ?? "",
    country: customer.country ?? "",
    phoneNumber: customer.phoneNumber ?? "",
    operatorCustomerReference: customer.operatorCustomerReference ?? "",
  };
}

export function readCaseValidationSnapshot(value: unknown): CaseValidationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const rule = readCaseRuleSnapshot(snapshot.rule);
  const customer = readCustomerSnapshot(snapshot.customer);
  if (
    snapshot.version !== 1 ||
    typeof snapshot.confirmedAt !== "string" ||
    !rule || !customer ||
    !Array.isArray(snapshot.documents) ||
    typeof snapshot.estimatedRecoverableCents !== "number" ||
    typeof snapshot.serviceFeeCents !== "number"
  ) return null;
  const documents = snapshot.documents.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const document = item as Record<string, unknown>;
    return typeof document.id === "string" && typeof document.kind === "string" && typeof document.originalName === "string"
      ? [{ id: document.id, kind: document.kind, originalName: document.originalName }]
      : [];
  });
  const postalExpenseClaim = readPostalExpenseClaimSnapshot(
    snapshot.postalExpenseClaim,
  );
  if (snapshot.postalExpenseClaim !== undefined && !postalExpenseClaim) {
    return null;
  }
  return {
    version: 1,
    confirmedAt: snapshot.confirmedAt,
    rule,
    customer,
    documents,
    estimatedRecoverableCents: snapshot.estimatedRecoverableCents,
    serviceFeeCents: snapshot.serviceFeeCents,
    ...(postalExpenseClaim ? { postalExpenseClaim } : {}),
  };
}

function readPostalExpenseClaimSnapshot(
  value: unknown,
): CaseValidationSnapshot["postalExpenseClaim"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claim = value as Record<string, unknown>;
  if (
    typeof claim.requested !== "boolean" ||
    (claim.selectedAt !== null && typeof claim.selectedAt !== "string") ||
    !claim.terms ||
    typeof claim.terms !== "object" ||
    Array.isArray(claim.terms)
  ) {
    return null;
  }
  return {
    requested: claim.requested,
    selectedAt: claim.selectedAt,
    terms: readPostalExpenseReimbursement(claim.terms),
  };
}

function readCustomerSnapshot(value: unknown): CaseCustomerSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const customer = value as Record<string, unknown>;
  const fields = ["email", "firstName", "lastName", "postalAddress", "postalCode", "city", "country", "phoneNumber", "operatorCustomerReference"] as const;
  if (fields.some((field) => typeof customer[field] !== "string")) return null;
  return Object.fromEntries(fields.map((field) => [field, customer[field]])) as CaseCustomerSnapshot;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cloneRecord(value: unknown): Record<string, unknown> {
  const record = readObject(value);
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function toSerializable(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? [] : JSON.parse(serialized) as unknown;
}
