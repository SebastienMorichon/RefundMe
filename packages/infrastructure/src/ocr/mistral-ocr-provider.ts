import type { OcrInput, OcrProvider, OcrResult } from "@lydoc/application";

export class MistralOcrProvider implements OcrProvider {
  constructor(private readonly apiKey: string) {}

  async extractText(input: OcrInput): Promise<OcrResult> {
    void this.apiKey;
    void input;

    throw new Error("Mistral OCR adapter is not implemented yet.");
  }
}

