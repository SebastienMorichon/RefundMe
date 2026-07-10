export type OcrInput = Readonly<{
  storageKey: string;
  mimeType: string;
}>;

export type OcrResult = Readonly<{
  text: string;
  provider: string;
  confidence?: number;
  raw: unknown;
}>;

export interface OcrProvider {
  extractText(input: OcrInput): Promise<OcrResult>;
}

