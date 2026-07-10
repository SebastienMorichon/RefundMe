export type OcrInput = Readonly<{
  bytes: Uint8Array;
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
