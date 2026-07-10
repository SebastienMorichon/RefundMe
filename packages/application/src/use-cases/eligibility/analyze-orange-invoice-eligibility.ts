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
}>;

export type OrangeInvoiceAnalysis = Readonly<{
  extractedText: string;
  isOrangeInvoice: boolean;
  participationCount: number;
  candidates: EligibilityCandidate[];
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
    const participationCount = countParticipations(normalizedText);
    const now = input.now ?? new Date();

    const candidates = isOrangeInvoice
      ? input.approvedRules
          .filter((rule) => isRuleCurrent(rule, now))
          .filter((rule) => normalizedText.includes(rule.organizerName.toLocaleLowerCase("fr-FR")))
          .map((rule) => this.toCandidate(rule, normalizedText, participationCount))
          .sort((left, right) => right.confidence - left.confidence)
      : [];

    return { extractedText, isOrangeInvoice, participationCount, candidates };
  }

  private toCandidate(
    rule: ApprovedRuleForMatching,
    normalizedText: string,
    participationCount: number,
  ): EligibilityCandidate {
    const evidence = ["Organisateur detecte dans la facture"];
    let confidence = 0.45;

    if (normalizedText.includes("facture")) {
      evidence.push("Libelle facture detecte");
      confidence += 0.15;
    }

    if (participationCount > 0) {
      evidence.push(`${participationCount} mention(s) de participation detectee(s)`);
      confidence += 0.2;
    }

    const keywords = readKeywords(rule.constraints);
    const matchedKeywords = keywords.filter((keyword) => normalizedText.includes(keyword.toLocaleLowerCase("fr-FR")));
    if (matchedKeywords.length > 0) {
      evidence.push(`Condition(s) detectee(s): ${matchedKeywords.join(", ")}`);
      confidence += Math.min(0.2, matchedKeywords.length * 0.1);
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      reimbursementCents: rule.reimbursementCents,
      confidence: Math.min(0.95, confidence),
      evidence,
      missingRequirements: requiredDocumentLabels(rule.requiredDocuments),
    };
  }
}

function countParticipations(text: string): number {
  const matches = text.match(/participation|participer|sms/gi);
  return matches?.length ?? 0;
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
