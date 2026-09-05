import { BadRequestException } from "@nestjs/common";
import type {
  CaseCustomerSnapshot,
  CaseRuleSnapshot,
} from "../eligibility/case-snapshots";
import type { PostalAddress } from "./postal-provider";

export function customerPostalAddress(
  customer: CaseCustomerSnapshot,
): PostalAddress {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    addressLine1: customer.postalAddress,
    postalCode: customer.postalCode,
    city: customer.city,
    country: customer.country || "France",
  };
}

export function ruleRecipientPostalAddress(
  rule: CaseRuleSnapshot,
): PostalAddress {
  const rawAddress = readText(rule.constraints.reimbursementAddress);
  const company =
    readText(rule.constraints.reimbursementRecipient) || rule.organizerName;
  const lines = rawAddress
    .split(/\r?\n|\s*,\s*/)
    .map((line) => line.trim())
    .filter(Boolean);
  let postalIndex = -1;
  let postalMatch: RegExpMatchArray | null = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]?.match(/(?:^|\s)(\d{5})\s+([^\d].*)$/) ?? null;
    if (!match) continue;
    postalIndex = index;
    postalMatch = match;
    break;
  }
  if (postalIndex < 0 || !postalMatch) {
    throw new BadRequestException(
      "L'adresse postale du reglement doit contenir un code postal et une ville.",
    );
  }

  const postalLine = lines[postalIndex]!;
  const prefix = postalLine.slice(0, postalMatch.index).trim();
  const addressLines = [
    ...lines.slice(0, postalIndex),
    ...(prefix ? [prefix] : []),
  ];
  stripRepeatedCompany(addressLines, company);
  if (!addressLines[0])
    throw new BadRequestException(
      "La voie du destinataire est absente du reglement.",
    );

  const country = readText(rule.constraints.reimbursementCountry) || "France";
  return {
    company,
    addressLine1: addressLines[0],
    ...(addressLines.length > 1
      ? { addressLine2: addressLines.slice(1).join(" ") }
      : {}),
    postalCode: postalMatch[1]!,
    city: stripCountrySuffix(postalMatch[2]!, country),
    country,
  };
}

function stripRepeatedCompany(lines: string[], company: string): void {
  const firstLine = lines[0];
  if (!firstLine || !company) return;
  const normalizedFirstLine = firstLine.toLocaleLowerCase("fr-FR");
  const normalizedCompany = company.toLocaleLowerCase("fr-FR");
  if (!normalizedFirstLine.startsWith(normalizedCompany)) return;

  const remainder = firstLine
    .slice(company.length)
    .replace(/^[\s,;:\-/]+/, "")
    .trim();
  if (remainder) lines[0] = remainder;
  else lines.shift();
}

function stripCountrySuffix(city: string, country: string): string {
  const suffixes = [...new Set([country, "France"])].filter(Boolean);
  let normalized = city.trim();
  for (const suffix of suffixes) {
    const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized
      .replace(new RegExp(`(?:,|\\s)+${escapedSuffix}$`, "i"), "")
      .trim();
  }
  return normalized;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
