export const managedPostalEnabled =
  process.env.NEXT_PUBLIC_MANAGED_POSTAL_ENABLED?.trim().toLowerCase() ===
  "true";

// The invoice archive stays hidden while invoice analysis remains available.
export const documentsPageEnabled = false;
export const reimbursementCreationEnabled = true;
