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

export type TelecomInvoiceAnalysis = Readonly<{
  extractedText: string;
  isOrangeInvoice: boolean;
  isTelecomInvoice: boolean;
  operatorName?: string;
  participationCount: number;
  detectedSmsCharges: SmsCharge[];
  candidates: EligibilityCandidate[];
}>;

export type OrangeInvoiceAnalysis = TelecomInvoiceAnalysis;

export type SmsCharge = Readonly<{
  label: string;
  code?: string;
  occurredOn?: string;
  quantity: number;
  amountCents: number;
  evidence: string;
}>;

export class AnalyzeTelecomInvoiceEligibility {
  execute(input: {
    text: string;
    approvedRules: ApprovedRuleForMatching[];
    selectedRuleId?: string;
    now?: Date;
  }): TelecomInvoiceAnalysis {
    const extractedText = input.text.replace(/\s+/g, " ").trim();
    const normalizedText = extractedText.toLocaleLowerCase("fr-FR");
    const operatorName = detectOperator(normalizedText);
    const isOrangeInvoice = operatorName === "Orange";
    const isTelecomInvoice = operatorName !== undefined || looksLikeTelecomInvoice(normalizedText);
    const detectedSmsCharges = extractSmsCharges(input.text);
    const participationCount = detectedSmsCharges.reduce((total, charge) => total + charge.quantity, 0);
    const now = input.now ?? new Date();

    const selectedRule = input.selectedRuleId
      ? input.approvedRules.find((rule) => rule.id === input.selectedRuleId)
      : undefined;
    const candidates = selectedRule
      ? this.selectedRuleCandidates(selectedRule, normalizedText, detectedSmsCharges, now)
      : this.automaticCandidates(input.approvedRules, normalizedText, detectedSmsCharges, now);

    return {
      extractedText,
      isOrangeInvoice,
      isTelecomInvoice,
      ...(operatorName ? { operatorName } : {}),
      participationCount,
      detectedSmsCharges,
      candidates,
    };
  }

  private selectedRuleCandidates(
    rule: ApprovedRuleForMatching,
    normalizedText: string,
    detectedSmsCharges: SmsCharge[],
    now: Date,
  ): EligibilityCandidate[] {
    const chargesInPeriod = detectedSmsCharges.some((charge) => charge.occurredOn)
      ? chargesApplicableToRule(rule, detectedSmsCharges, now)
      : detectedSmsCharges;
    const shortCodes = readShortCodes(rule.constraints);
    const matchingCharges = shortCodes.length > 0
      ? chargesInPeriod.filter((charge) => charge.code && shortCodes.includes(charge.code))
      : chargesInPeriod;
    if (matchingCharges.length === 0) return [];

    const participationCount = matchingCharges.reduce((total, charge) => total + charge.quantity, 0);
    const reimbursementCents = matchingCharges.reduce((total, charge) => total + charge.amountCents, 0);
    return [{
      ruleId: rule.id,
      ruleName: rule.name,
      reimbursementCents,
      confidence: normalizedText.includes("facture") ? 0.92 : 0.82,
      evidence: [
        `Jeu selectionne par le client: ${rule.name}`,
        ...(shortCodes.length > 0 ? [`Numero court attendu: ${shortCodes.join(", ")}`] : []),
        `${participationCount} SMS+ eligible(s) detecte(s)`,
        ...matchingCharges.map((charge) => `Ligne SMS+: ${charge.label} (${formatCents(charge.amountCents)})`),
      ],
      missingRequirements: requiredDocumentLabels(rule.requiredDocuments),
      detectedSmsCharges: matchingCharges,
    }];
  }

  private automaticCandidates(
    rules: ApprovedRuleForMatching[],
    normalizedText: string,
    detectedSmsCharges: SmsCharge[],
    now: Date,
  ): EligibilityCandidate[] {
    const matchableRules = rules.flatMap((rule) => {
      const eligibleCharges = chargesApplicableToRule(rule, detectedSmsCharges, now);
      return eligibleCharges.length > 0 ? [{ rule, eligibleCharges }] : [];
    });
    const organizerOnlyRuleId = findUniqueOpaqueOrganizerRule(matchableRules);

    return matchableRules
      .map(({ rule, eligibleCharges }) =>
        this.toCandidate(rule, normalizedText, eligibleCharges, rule.id === organizerOnlyRuleId),
      )
      .filter((candidate): candidate is EligibilityCandidate => candidate !== null)
      .sort((left, right) => right.confidence - left.confidence);
  }

  private toCandidate(
    rule: ApprovedRuleForMatching,
    normalizedText: string,
    detectedSmsCharges: SmsCharge[],
    allowOrganizerOnlyMatch: boolean,
  ): EligibilityCandidate | null {
    const ruleMatch = findRuleMatch(rule, detectedSmsCharges, allowOrganizerOnlyMatch);
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

export class AnalyzeOrangeInvoiceEligibility extends AnalyzeTelecomInvoiceEligibility {}

function isRuleCurrent(rule: ApprovedRuleForMatching, now: Date): boolean {
  const today = toDateKey(now);
  const validFrom = rule.validFrom ? toDateKey(rule.validFrom) : undefined;
  const validUntil = rule.validUntil ? toDateKey(rule.validUntil) : undefined;
  return (!validFrom || today >= validFrom) && (!validUntil || today <= validUntil);
}

function chargesApplicableToRule(
  rule: ApprovedRuleForMatching,
  charges: SmsCharge[],
  now: Date,
): SmsCharge[] {
  const datedCharges = charges.filter((charge) => charge.occurredOn);
  if (datedCharges.length === 0) {
    return isRuleCurrent(rule, now) ? charges : [];
  }

  return datedCharges.filter((charge) => isDateWithinRule(charge.occurredOn!, rule));
}

function isDateWithinRule(occurredOn: string, rule: ApprovedRuleForMatching): boolean {
  const validFrom = rule.validFrom ? toDateKey(rule.validFrom) : undefined;
  const validUntil = rule.validUntil ? toDateKey(rule.validUntil) : undefined;
  return (!validFrom || occurredOn >= validFrom) && (!validUntil || occurredOn <= validUntil);
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function readKeywords(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const keywords = (value as Record<string, unknown>).keywords;
  return Array.isArray(keywords) ? keywords.filter((keyword): keyword is string => typeof keyword === "string") : [];
}

function extractSmsCharges(text: string): SmsCharge[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const invoiceYear = readInvoiceYear(text);

  return lines.flatMap((line, index) => {
      const normalizedLine = line.toLocaleLowerCase("fr-FR");
      const code = line.match(/\b\d{5}\b/)?.[0];
      if (!code) {
        return [];
      }

      const hasDirectSmsSignal = /(sms\+?|jeu|vote|participation|rembours)/i.test(line);
      const hasEncodedSmsService = /\bacte-\d{5}-[a-z0-9_-]+/i.test(line);
      if (!hasDirectSmsSignal && !hasEncodedSmsService && !hasNearbySmsSection(lines, index)) {
        return [];
      }
      if (/(app store|abonnement|musique|achat multimedia)/i.test(line)) {
        return [];
      }

      const amountCents = readLastChargeAmount(line);
      if (amountCents <= 0) {
        return [];
      }

      const quantity = readSmsQuantity(line);
      const label = line.replace(/^\|\s*|\s*\|$/g, "").trim();
      const occurredOn = readChargeDate(line, invoiceYear);

      return [{
        label,
        code,
        ...(occurredOn ? { occurredOn } : {}),
        quantity,
        amountCents,
        evidence: normalizedLine,
      }];
    });
}

function readInvoiceYear(text: string): number | undefined {
  const numericDate = text.match(/\b\d{1,2}[./-]\d{1,2}[./-](20\d{2})\b/);
  if (numericDate?.[1]) {
    return Number.parseInt(numericDate[1], 10);
  }

  const writtenDate = text.match(
    /\b\d{1,2}\s+(?:janvier|fevrier|f[ée]vrier|mars|avril|mai|juin|juillet|aout|ao[ûu]t|septembre|octobre|novembre|decembre|d[ée]cembre)\s+(20\d{2})\b/i,
  );
  return writtenDate?.[1] ? Number.parseInt(writtenDate[1], 10) : undefined;
}

function readChargeDate(line: string, invoiceYear?: number): string | undefined {
  const match = line.match(/\b([0-3]?\d)[./-]([01]?\d)(?:[./-](20\d{2}))?\b/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const year = match[3] ? Number.parseInt(match[3], 10) : invoiceYear;
  if (!year) {
    return undefined;
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

function hasNearbySmsSection(lines: string[], index: number): boolean {
  const firstNearbyLine = Math.max(0, index - 12);
  return lines
    .slice(firstNearbyLine, index)
    .some((line) => /(achats?\s+(?:par\s+)?sms|achats?\s+sms\+)/i.test(line));
}

function readLastChargeAmount(line: string): number {
  const amounts = [...line.matchAll(/(\d{1,3}(?:[ .]\d{3})*|\d+),(\d{2,3})(?=\s*(?:eur|\u20ac|\||$))/gi)];
  const lastAmount = amounts.at(-1);
  if (!lastAmount) {
    return 0;
  }
  const euros = lastAmount[1]?.replace(/[ .]/g, "") ?? "0";
  const cents = lastAmount[2] ?? "00";
  return Math.round(Number(`${euros}.${cents}`) * 100);
}

function readSmsQuantity(line: string): number {
  const matches = [...line.matchAll(/\b(\d+)\s*sms\b/gi)];
  const quantity = matches.at(-1)?.[1];
  return quantity ? Number.parseInt(quantity, 10) : 1;
}

function findUniqueOpaqueOrganizerRule(
  matches: Array<{ rule: ApprovedRuleForMatching; eligibleCharges: SmsCharge[] }>,
): string | undefined {
  const organizerMatches = matches.filter(({ rule, eligibleCharges }) => {
    if (!rule.validFrom || !rule.validUntil) {
      return false;
    }
    const organizerTerms = organizerTermsForMatching(rule.organizerName);
    return eligibleCharges.some((charge) =>
      charge.occurredOn &&
      isOpaqueServiceCharge(charge) &&
      organizerTerms.some((term) => charge.evidence.includes(term)),
    );
  });

  return organizerMatches.length === 1 ? organizerMatches[0]?.rule.id : undefined;
}

function findRuleMatch(
  rule: ApprovedRuleForMatching,
  charges: SmsCharge[],
  allowOrganizerOnlyMatch: boolean,
) {
  const organizerTerms = organizerTermsForMatching(rule.organizerName);
  const ruleNameTerms = tokenize(rule.name).filter((term) => !GENERIC_RULE_TERMS.has(term));
  const keywordTerms = readKeywords(rule.constraints).flatMap(tokenize).filter((term) => !GENERIC_RULE_TERMS.has(term));
  const shortCodes = readShortCodes(rule.constraints);
  const specificTerms = [...new Set([...ruleNameTerms, ...keywordTerms])];

  const matchingCharges = charges.filter((charge) => {
    const text = charge.evidence;
    const organizerMatched = organizerTerms.some((term) => text.includes(term));
    const specificMatched = specificTerms.some((term) => text.includes(term));
    const codeMatched = charge.code ? shortCodes.includes(charge.code) : false;
    const organizerOnlyMatched = allowOrganizerOnlyMatch && isOpaqueServiceCharge(charge);
    return organizerMatched && (specificMatched || codeMatched || organizerOnlyMatched);
  });

  if (matchingCharges.length === 0) {
    return null;
  }

  const matchedTerms = specificTerms.filter((term) => matchingCharges.some((charge) => charge.evidence.includes(term)));
  const matchedCodes = shortCodes.filter((code) => matchingCharges.some((charge) => charge.code === code));
  const usedOrganizerOnlyMatch = matchedTerms.length === 0 && matchedCodes.length === 0;
  return {
    charges: matchingCharges,
    evidence: [
      `Organisateur detecte: ${rule.organizerName}`,
      ...(matchedTerms.length > 0 ? [`Jeu ou mot-cle detecte: ${matchedTerms.join(", ")}`] : []),
      ...(matchedCodes.length > 0 ? [`Code court detecte: ${matchedCodes.join(", ")}`] : []),
      ...(usedOrganizerOnlyMatch ? ["Reglement unique pour cet organisateur a la date des SMS"] : []),
      ...matchingCharges.map((charge) => `Ligne SMS+: ${charge.label} (${formatCents(charge.amountCents)})`),
    ],
    confidenceBoost: Math.min(
      0.2,
      matchedTerms.length * 0.08 + matchedCodes.length * 0.12 + (usedOrganizerOnlyMatch ? 0.02 : 0),
    ),
  };
}

function isOpaqueServiceCharge(charge: SmsCharge): boolean {
  return /\bacte-\d{5}-[a-z0-9_-]+\b/i.test(charge.evidence);
}

function detectOperator(normalizedText: string): string | undefined {
  if (/\bbouygues(?:\s+telecom)?\b/.test(normalizedText)) {
    return "Bouygues Telecom";
  }
  if (/\borange(?:\s+france)?\b/.test(normalizedText)) {
    return "Orange";
  }
  if (/\bsfr\b/.test(normalizedText)) {
    return "SFR";
  }
  if (/\bfree\s+mobile\b/.test(normalizedText)) {
    return "Free Mobile";
  }
  return undefined;
}

function looksLikeTelecomInvoice(normalizedText: string): boolean {
  return normalizedText.includes("facture")
    && /(forfait|communications|sms\/mms|numero de ligne|numéro de ligne)/i.test(normalizedText);
}

function organizerTermsForMatching(value: string): string[] {
  const terms = tokenize(value);
  const normalized = value
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  if (normalized.includes("metropole television") || terms.includes("m6")) {
    terms.push("m6");
  }

  return [...new Set(terms)];
}

function readShortCodes(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const constraints = value as Record<string, unknown>;
  const candidateValues = [
    ...readKeywords(value),
    ...[
      constraints.participationMechanism,
      constraints.detection,
      constraints.shortCode,
      constraints.smsShortCode,
    ].filter((item): item is string => typeof item === "string"),
    ...[constraints.shortCodes, constraints.smsShortCodes].flatMap((item) =>
      Array.isArray(item)
        ? item.filter((entry): entry is string => typeof entry === "string")
        : [],
    ),
  ];

  return [
    ...new Set(
      candidateValues.flatMap((candidate) =>
        [...candidate.matchAll(/(?:^|\D)(\d{2})[\s.-]?(\d{3})(?!\d)/g)].flatMap((match) =>
          match[1] && match[2] ? [`${match[1]}${match[2]}`] : [],
        ),
      ),
    ),
  ];
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
