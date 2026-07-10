import type { DocumentKind } from "@lydoc/domain";

export type DocumentClassificationInput = Readonly<{
  text: string;
  mimeType: string;
}>;

export type DocumentClassificationResult = Readonly<{
  kind: DocumentKind;
  confidence: number;
}>;

export type BusinessFactExtractionInput = Readonly<{
  kind: DocumentKind;
  text: string;
}>;

export type BusinessFactExtractionResult = Readonly<{
  facts: Record<string, unknown>;
  confidence: number;
}>;

export interface DocumentProvider {
  classify(input: DocumentClassificationInput): Promise<DocumentClassificationResult>;
  extractBusinessFacts(input: BusinessFactExtractionInput): Promise<BusinessFactExtractionResult>;
}

