export type ApprovedRuleForMatching = Readonly<{
  id: string;
  organizerName: string;
  name: string;
  reimbursementCents: number;
  requiredDocuments: unknown;
  constraints: unknown;
  validFrom?: Date;
  validUntil?: Date;
}>;

export type EligibilityCandidate = Readonly<{
  ruleId: string;
  ruleName: string;
  reimbursementCents: number;
  confidence: number;
  evidence: string[];
  missingRequirements: string[];
  detectedSmsCharges: SmsCharge[];
}>;

export type OrangeInvoiceAnalysis = Readonly<{
  extractedText: string;
  isOrangeInvoice: boolean;
  participationCount: number;
  detectedSmsCharges: SmsCharge[];
  candidates: EligibilityCandidate[];
}>;

export type SmsCharge = Readonly<{
  label: string;
  code?: string;
  quantity: number;
  amountCents: number;
  evidence: string;
}>;

export class AnalyzeOrangeInvoiceEligibility {
  execute(input: {
    text: string;
    approvedRules: ApprovedRuleForMatching[];
    now?: Date;
  }): OrangeInvoiceAnalysis {
    const extractedText = input.text.replace(/\s+/g, " ").trim();
    const normalizedText = extractedText.toLocaleLowerCase("fr-FR");
    const isOrangeInvoice = normalizedText.includes("orange");
    const detectedSmsCharges = extractSmsCharges(input.text);
    const participationCount = detectedSmsCharges.reduce((total, charge) => total + charge.quantity, 0);
    const now = input.now ?? new Date();

    const candidates = isOrangeInvoice
      ? input.approvedRules
          .filter((rule) => isRuleCurrent(rule, now))
          .map((rule) => this.toCandidate(rule, normalizedText, detectedSmsCharges))
          .filter((candidate): candidate is EligibilityCandidate => candidate !== null)
          .sort((left, right) => right.confidence - left.confidence)
      : [];

    return { extractedText, isOrangeInvoice, participationCount, detectedSmsCharges, candidates };
  }

  private toCandidate(
    rule: ApprovedRuleForMatching,
    normalizedText: string,
    detectedSmsCharges: SmsCharge[],
  ): EligibilityCandidate | null {
    const ruleMatch = findRuleMatch(rule, detectedSmsCharges);
    if (!ruleMatch || ruleMatch.charges.length === 0) {
      return null;
    }

    const evidence = [...ruleMatch.evidence];
    let confidence = 0.45 + ruleMatch.confidenceBoost;

    if (normalizedText.includes("facture")) {
      evidence.push("Libelle facture detecte");
      confidence += 0.15;
    }

    const participationCount = ruleMatch.charges.reduce((total, charge) => total + charge.quantity, 0);
    if (participationCount > 0) {
      evidence.push(`${participationCount} SMS+ eligible(s) detecte(s)`);
      confidence += 0.2;
    }

    const reimbursementCents = ruleMatch.charges.reduce((total, charge) => total + charge.amountCents, 0);

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      reimbursementCents,
      confidence: Math.min(0.95, confidence),
      evidence,
      missingRequirements: requiredDocumentLabels(rule.requiredDocuments),
      detectedSmsCharges: ruleMatch.charges,
    };
  }
}

function isRuleCurrent(rule: ApprovedRuleForMatching, now: Date): boolean {
  return (!rule.validFrom || rule.validFrom <= now) && (!rule.validUntil || rule.validUntil >= now);
}

function readKeywords(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const keywords = (value as Record<string, unknown>).keywords;
  return Array.isArray(keywords) ? keywords.filter((keyword): keyword is string => typeof keyword === "string") : [];
}

function extractSmsCharges(text: string): SmsCharge[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((line) => {
      const normalizedLine = line.toLocaleLowerCase("fr-FR");
      if (!/(sms\+|sms)/i.test(line) || !/(jeu|vote|participation|rembours)/i.test(line)) {
        return [];
      }
      const code = line.match(/\b\d{5}\b/)?.[0];
      if (!code) {
        return [];
      }
      if (/(app store|abonnement|musique|achat multimedia)/i.test(line)) {
        return [];
      }

      const amountCents = readLastEuroAmount(line);
      if (amountCents <= 0) {
        return [];
      }

      const quantity = readSmsQuantity(line);
      const label = line.replace(/\s+\d+,\d{2}\s*(?:eur|€)\s*$/i, "").trim();

      return [{
        label,
        code,
        quantity,
        amountCents,
        evidence: normalizedLine,
      }];
    });
}

function readLastEuroAmount(line: string): number {
  const amounts = [...line.matchAll(/(\d{1,3}(?:[ .]\d{3})*|\d+),(\d{2})\s*(?:eur|€)/gi)];
  const lastAmount = amounts.at(-1);
  if (!lastAmount) {
    return 0;
  }
  const euros = lastAmount[1]?.replace(/[ .]/g, "") ?? "0";
  const cents = lastAmount[2] ?? "00";
  return Number.parseInt(euros, 10) * 100 + Number.parseInt(cents, 10);
}

function readSmsQuantity(line: string): number {
  const matches = [...line.matchAll(/\b(\d+)\s*sms\b/gi)];
  const quantity = matches.at(-1)?.[1];
  return quantity ? Number.parseInt(quantity, 10) : 1;
}

function findRuleMatch(rule: ApprovedRuleForMatching, charges: SmsCharge[]) {
  const organizerTerms = tokenize(rule.organizerName);
  const ruleNameTerms = tokenize(rule.name).filter((term) => !GENERIC_RULE_TERMS.has(term));
  const keywordTerms = readKeywords(rule.constraints).flatMap(tokenize).filter((term) => !GENERIC_RULE_TERMS.has(term));
  const specificTerms = [...new Set([...ruleNameTerms, ...keywordTerms])];

  const matchingCharges = charges.filter((charge) => {
    const text = charge.evidence;
    const organizerMatched = organizerTerms.some((term) => text.includes(term));
    const specificMatched = specificTerms.some((term) => text.includes(term));
    return organizerMatched && specificMatched;
  });

  if (matchingCharges.length === 0) {
    return null;
  }

  const matchedTerms = specificTerms.filter((term) => matchingCharges.some((charge) => charge.evidence.includes(term)));
  return {
    charges: matchingCharges,
    evidence: [
      `Organisateur detecte: ${rule.organizerName}`,
      `Jeu ou mot-cle detecte: ${matchedTerms.join(", ")}`,
      ...matchingCharges.map((charge) => `Ligne SMS+: ${charge.label} (${formatCents(charge.amountCents)})`),
    ],
    confidenceBoost: Math.min(0.2, matchedTerms.length * 0.08),
  };
}

function tokenize(value: string): string[] {
  return value
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .match(/[a-z0-9]{2,}/g)
    ?.filter((term) => /[a-z]/.test(term)) ?? [];
}

function formatCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} EUR`;
}

const GENERIC_RULE_TERMS = new Set([
  "jeu",
  "jeux",
  "sms",
  "sms+",
  "participation",
  "participer",
  "remboursement",
  "remboursable",
  "reglement",
  "concours",
  "offre",
  "demande",
]);

function requiredDocumentLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((document) => {
    if (!document || typeof document !== "object") {
      return [];
    }

    const candidate = document as Record<string, unknown>;
    return candidate.required === true && typeof candidate.label === "string" ? [candidate.label] : [];
  });
}
