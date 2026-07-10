import type { AiProvider } from "../../ports/ai-provider";
import type { OcrProvider } from "../../ports/ocr-provider";

export type GameRuleCandidate = Readonly<{
  name: string;
  organizerName: string;
  reimbursementCents: number;
  requiredDocuments: Array<{
    kind: string;
    label: string;
    required: boolean;
  }>;
  constraints: Record<string, unknown>;
}>;

export class ExtractGameRuleCandidate {
  constructor(
    private readonly ocrProvider: OcrProvider,
    private readonly aiProvider: AiProvider,
  ) {}

  async execute(input: { bytes: Uint8Array; mimeType: string }): Promise<GameRuleCandidate> {
    const ocr = await this.ocrProvider.extractText(input);
    const extraction = await this.aiProvider.extractStructuredData<GameRuleCandidate>({
      documentText: ocr.text,
      locale: "fr-FR",
      instruction:
        "Extraire une proposition de regle de remboursement. Ne pas inventer les champs absents.",
    });

    return extraction.data;
  }
}
