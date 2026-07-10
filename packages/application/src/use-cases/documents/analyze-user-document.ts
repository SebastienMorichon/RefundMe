import type { DocumentProvider } from "../../ports/document-provider";
import type { OcrProvider } from "../../ports/ocr-provider";

export type AnalyzeUserDocumentResult = Readonly<{
  kind: string;
  classificationConfidence: number;
  facts: Record<string, unknown>;
  factsConfidence: number;
}>;

export class AnalyzeUserDocument {
  constructor(
    private readonly ocrProvider: OcrProvider,
    private readonly documentProvider: DocumentProvider,
  ) {}

  async execute(input: { storageKey: string; mimeType: string }): Promise<AnalyzeUserDocumentResult> {
    const ocr = await this.ocrProvider.extractText(input);
    const classification = await this.documentProvider.classify({
      text: ocr.text,
      mimeType: input.mimeType,
    });
    const extracted = await this.documentProvider.extractBusinessFacts({
      kind: classification.kind,
      text: ocr.text,
    });

    return {
      kind: classification.kind,
      classificationConfidence: classification.confidence,
      facts: extracted.facts,
      factsConfidence: extracted.confidence,
    };
  }
}

