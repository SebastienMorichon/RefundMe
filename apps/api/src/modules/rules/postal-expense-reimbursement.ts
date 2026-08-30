export const postalExpenseClaimScopes = [
  "PER_REQUEST",
  "PER_PARTICIPANT_PER_MONTH",
  "PER_PARTICIPANT_PER_GAME",
  "PER_HOUSEHOLD_PER_GAME",
  "OTHER",
  "UNSPECIFIED",
] as const;

export const postalExpenseAppliesTo = [
  "REFUND_REQUEST",
  "RULE_COPY_REQUEST",
  "BOTH",
  "UNSPECIFIED",
] as const;

export type PostalExpenseClaimScope =
  (typeof postalExpenseClaimScopes)[number];
export type PostalExpenseAppliesTo =
  (typeof postalExpenseAppliesTo)[number];

export type PostalExpenseReimbursement = Readonly<{
  available: boolean;
  appliesTo: PostalExpenseAppliesTo;
  postage: Readonly<{
    reimbursable: boolean;
    amountCents: number | null;
    basis: string;
  }>;
  printing: Readonly<{
    reimbursable: boolean;
    centsPerPage: number | null;
    maxPages: number | null;
    basis: string;
  }>;
  claimLimit: Readonly<{
    scope: PostalExpenseClaimScope;
    strict: boolean;
    details: string;
  }>;
  requestInstructions: string;
  requiredProofs: string[];
  sourceReference: string;
}>;

export function readPostalExpenseReimbursement(
  value: unknown,
): PostalExpenseReimbursement {
  const input = readObject(value);
  const postage = readObject(input.postage);
  const printing = readObject(input.printing);
  const claimLimit = readObject(input.claimLimit);
  const appliesTo = readEnum(input.appliesTo, postalExpenseAppliesTo);
  const scope = readEnum(claimLimit.scope, postalExpenseClaimScopes);
  const postageReimbursable = input.available === true && postage.reimbursable === true;
  const printingReimbursable = input.available === true && printing.reimbursable === true;

  return {
    available:
      input.available === true &&
      (postageReimbursable || printingReimbursable),
    appliesTo: appliesTo ?? "UNSPECIFIED",
    postage: {
      reimbursable: postageReimbursable,
      amountCents: readOptionalNonNegativeInteger(postage.amountCents),
      basis: readText(postage.basis),
    },
    printing: {
      reimbursable: printingReimbursable,
      centsPerPage: readOptionalNonNegativeInteger(printing.centsPerPage),
      maxPages: readOptionalPositiveInteger(printing.maxPages),
      basis: readText(printing.basis),
    },
    claimLimit: {
      scope: scope ?? "UNSPECIFIED",
      strict: claimLimit.strict === true,
      details: readText(claimLimit.details),
    },
    requestInstructions: readText(input.requestInstructions),
    requiredProofs: readTextArray(input.requiredProofs),
    sourceReference: readText(input.sourceReference),
  };
}

export function canRequestPostalExpenseReimbursement(
  value: PostalExpenseReimbursement,
): boolean {
  return (
    value.available &&
    (value.appliesTo === "REFUND_REQUEST" || value.appliesTo === "BOTH") &&
    (value.postage.reimbursable || value.printing.reimbursable)
  );
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = readText(item);
        return text ? [text] : [];
      })
    : [];
}

function readOptionalNonNegativeInteger(value: unknown): number | null {
  const parsed = readNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : null;
}

function readOptionalPositiveInteger(value: unknown): number | null {
  const parsed = readNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function readNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}
