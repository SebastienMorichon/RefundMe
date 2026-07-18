import { BadRequestException } from "@nestjs/common";
import type { CaseCustomerSnapshot, CaseRuleSnapshot } from "../eligibility/case-snapshots";
import type { PostalAddress } from "./postal-provider";

export function customerPostalAddress(customer: CaseCustomerSnapshot): PostalAddress {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    addressLine1: customer.postalAddress,
    postalCode: customer.postalCode,
    city: customer.city,
    country: customer.country || "France",
  };
}

export function ruleRecipientPostalAddress(rule: CaseRuleSnapshot): PostalAddress {
  const rawAddress = readText(rule.constraints.reimbursementAddress);
  const company = readText(rule.constraints.reimbursementRecipient) || rule.organizerName;
  const lines = rawAddress.split(/\r?\n|\s*,\s*/).map((line) => line.trim()).filter(Boolean);
  const postalIndex = lines.findIndex((line) => /\b\d{5}\b/.test(line));
  if (postalIndex < 0) {
    throw new BadRequestException("L'adresse postale du reglement doit contenir un code postal et une ville.");
  }
  const match = lines[postalIndex]?.match(/\b(\d{5})\s+(.+)$/);
  if (!match) {
    throw new BadRequestException("L'adresse postale du destinataire est incomplete.");
  }
  const addressLines = lines.slice(0, postalIndex);
  if (!addressLines[0]) throw new BadRequestException("La voie du destinataire est absente du reglement.");
  return {
    company,
    addressLine1: addressLines[0],
    ...(addressLines.length > 1 ? { addressLine2: addressLines.slice(1).join(" ") } : {}),
    postalCode: match[1]!,
    city: match[2]!,
    country: readText(rule.constraints.reimbursementCountry) || "France",
  };
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
