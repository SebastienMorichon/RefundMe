export const managedPostalEnabled =
  process.env.NEXT_PUBLIC_MANAGED_POSTAL_ENABLED?.trim().toLowerCase() ===
  "true";
