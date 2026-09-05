export type CustomerProfileData = Readonly<{
  firstName: string | null;
  lastName: string | null;
  postalAddress: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phoneNumber: string | null;
  operatorCustomerReference: string | null;
}>;

const requiredProfileFields: ReadonlyArray<readonly [keyof CustomerProfileData, string]> = [
  ["firstName", "Prenom"],
  ["lastName", "Nom"],
  ["postalAddress", "Adresse postale"],
  ["postalCode", "Code postal"],
  ["city", "Ville"],
  ["country", "Pays"],
  ["phoneNumber", "Numero de telephone participant"],
];

export function missingCustomerProfileFields(profile: CustomerProfileData): string[] {
  return requiredProfileFields
    .filter(([field]) => !profile[field]?.trim())
    .map(([, label]) => label);
}

export function presentCustomerProfile(profile: CustomerProfileData) {
  const missingFields = missingCustomerProfileFields(profile);
  return { ...profile, complete: missingFields.length === 0, missingFields };
}
