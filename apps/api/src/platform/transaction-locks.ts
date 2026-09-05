import type { Prisma } from "@prisma/client";

type AdvisoryLockTransaction = Pick<Prisma.TransactionClient, "$executeRaw">;

/**
 * Serializes every operation which can create, confirm, invalidate or delete a
 * Stripe checkout for a case. Keep this key in sync across all call sites.
 */
export async function lockStripeCheckoutCase(
  transaction: AdvisoryLockTransaction,
  caseId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${stripeCheckoutLockKey(caseId)}))
  `;
}

/** Serializes profile snapshots with checkout creation for one customer. */
export async function lockCustomerProfile(
  transaction: AdvisoryLockTransaction,
  ownerId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${customerProfileLockKey(ownerId)}))
  `;
}

/** Serializes generation and any mutation of the documents frozen in a PDF. */
export async function lockGeneratedPacketCase(
  transaction: AdvisoryLockTransaction,
  caseId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${generatedPacketLockKey(caseId)}))
  `;
}

/** Serializes lifecycle tombstones with every attachment of the document. */
export async function lockDocumentLifecycle(
  transaction: AdvisoryLockTransaction,
  documentId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${documentLifecycleLockKey(documentId)}))
  `;
}

/** Serializes all edits, approval and deletion of one reviewed rule. */
export async function lockGameRule(
  transaction: AdvisoryLockTransaction,
  ruleId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${gameRuleLockKey(ruleId)}))
  `;
}

export function stripeCheckoutLockKey(caseId: string): string {
  return `stripe-checkout:${caseId}`;
}

export function generatedPacketLockKey(caseId: string): string {
  return `generated-packet:${caseId}`;
}

export function customerProfileLockKey(ownerId: string): string {
  return `customer-profile:${ownerId}`;
}

export function documentLifecycleLockKey(documentId: string): string {
  return `document-lifecycle:${documentId}`;
}

export function gameRuleLockKey(ruleId: string): string {
  return `game-rule:${ruleId}`;
}
