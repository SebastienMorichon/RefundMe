export const managedPostalEnabled =
  process.env.NEXT_PUBLIC_MANAGED_POSTAL_ENABLED?.trim().toLowerCase() ===
  "true";

// Hidden by default while the customer-facing invoice workspace is paused.
// Set the public flag to true to restore its route, navigation and entry points.
export const documentsPageEnabled =
  process.env.NEXT_PUBLIC_DOCUMENTS_PAGE_ENABLED?.trim().toLowerCase() ===
  "true";
