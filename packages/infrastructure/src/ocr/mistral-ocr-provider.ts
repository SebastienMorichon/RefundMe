import type { OcrInput, OcrProvider, OcrResult } from "@lydoc/application";

export class MistralOcrProvider implements OcrProvider {
  constructor(private readonly apiKey: string) {}

  async extractText(input: OcrInput): Promise<OcrResult> {
    if (!this.apiKey || this.apiKey === "change_me") {
      throw new Error("MISTRAL_API_KEY doit etre configuree pour utiliser l'OCR.");
    }

    const response = await fetch("https://api.mistral.ai/v1/ocr", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-ocr-latest",
        document: createDocumentPayload(input),
        confidence_scores_granularity: "page",
      }),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Mistral OCR a refuse le document (HTTP ${response.status}).`);
    }

    const pages = readPages(payload);
    if (pages.length === 0) {
      throw new Error("Mistral OCR n'a retourne aucun texte exploitable.");
    }

    const confidenceValues = pages
      .map((page) => page.confidence)
      .filter((confidence): confidence is number => confidence !== undefined);

    return {
      text: pages.map((page) => page.markdown).join("\n\n"),
      provider: "mistral-ocr-latest",
      ...(confidenceValues.length > 0
        ? { confidence: confidenceValues.reduce((total, confidence) => total + confidence, 0) / confidenceValues.length }
        : {}),
      raw: { pagesProcessed: pages.length },
    };
  }
}

function createDocumentPayload(input: OcrInput) {
  const base64 = Buffer.from(input.bytes).toString("base64");
  const dataUrl = `data:${input.mimeType};base64,${base64}`;

  return input.mimeType === "application/pdf"
    ? { type: "document_url", document_url: dataUrl }
    : { type: "image_url", image_url: dataUrl };
}

function readPages(payload: unknown): Array<{ markdown: string; confidence?: number }> {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const pages = (payload as Record<string, unknown>).pages;
  if (!Array.isArray(pages)) {
    return [];
  }

  return pages.flatMap((page): Array<{ markdown: string; confidence?: number }> => {
    if (!page || typeof page !== "object") {
      return [];
    }

    const value = page as Record<string, unknown>;
    if (typeof value.markdown !== "string") {
      return [];
    }

    const scores = value.confidence_scores as Record<string, unknown> | undefined;
    const confidence = scores && typeof scores.average_page_confidence_score === "number"
      ? scores.average_page_confidence_score
      : undefined;
    return confidence === undefined ? [{ markdown: value.markdown }] : [{ markdown: value.markdown, confidence }];
  });
}
