import type { OcrInput, OcrProvider, OcrResult } from "@lydoc/application";
import { PDFDocument } from "pdf-lib";
import { boundedJsonRequest } from "../http/bounded-json-request";
import {
  reserveMistralRequest,
  waitForMistralRequestSlot,
} from "../http/mistral-request-budget";

const maxInputBytes = 20 * 1024 * 1024;
const maxResponseBytes = 12 * 1024 * 1024;
const maxPdfPagesPerRequest = 10;

export class MistralOcrProvider implements OcrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly options: Readonly<{
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    }> = {},
  ) {}

  async extractText(input: OcrInput): Promise<OcrResult> {
    if (!this.apiKey || this.apiKey === "change_me") {
      throw new Error("MISTRAL_API_KEY doit etre configuree pour utiliser l'OCR.");
    }
    if (
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > maxInputBytes ||
      !["application/pdf", "image/png", "image/jpeg"].includes(input.mimeType)
    ) {
      throw new Error("Le document OCR est vide, trop volumineux ou dans un format non accepte.");
    }

    const inputs = await splitPdfForOcr(input);
    const pages = [];
    for (const requestInput of inputs) {
      pages.push(...await this.extractPages(requestInput));
    }
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

  private async extractPages(input: OcrInput) {
    await waitForMistralRequestSlot(this.options.fetchImpl ? 0 : undefined);
    const releaseBudget = reserveMistralRequest();
    const { response, payload } = await boundedJsonRequest(
      "https://api.mistral.ai/v1/ocr",
      {
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
      },
      {
        timeoutMs: this.options.timeoutMs ?? 30_000,
        maxResponseBytes,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      },
    ).finally(releaseBudget);
    if (!response.ok) {
      throw new Error(`Mistral OCR a refuse le document (HTTP ${response.status}).`);
    }
    return readPages(payload);
  }
}

async function splitPdfForOcr(input: OcrInput): Promise<OcrInput[]> {
  if (input.mimeType !== "application/pdf") return [input];

  const source = await PDFDocument.load(input.bytes);
  if (source.getPageCount() <= maxPdfPagesPerRequest) return [input];

  const chunks: OcrInput[] = [];
  for (let firstPage = 0; firstPage < source.getPageCount(); firstPage += maxPdfPagesPerRequest) {
    const chunk = await PDFDocument.create();
    const pageIndexes = Array.from(
      { length: Math.min(maxPdfPagesPerRequest, source.getPageCount() - firstPage) },
      (_, index) => firstPage + index,
    );
    const copiedPages = await chunk.copyPages(source, pageIndexes);
    copiedPages.forEach((page) => chunk.addPage(page));
    chunks.push({ bytes: Buffer.from(await chunk.save()), mimeType: input.mimeType });
  }
  return chunks;
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
