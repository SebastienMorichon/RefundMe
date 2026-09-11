export const managedPostalEnabled =
  process.env.NEXT_PUBLIC_MANAGED_POSTAL_ENABLED?.trim().toLowerCase() ===
  "true";

// The customer-facing invoice archive is intentionally hidden. Invoice
// analysis remains available as the entry point for a new reimbursement.
export const documentsPageEnabled = false;
export const reimbursementCreationEnabled = true;

// Local development deliberately omits watermarks; production keeps the
// existing protection until its recipient-acceptance policy is changed.
export const sensitiveDocumentWatermarkingEnabled =
  process.env.NODE_ENV === "production";
