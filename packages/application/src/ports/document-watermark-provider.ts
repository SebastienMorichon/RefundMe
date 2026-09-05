import type { DocumentKind } from "@lydoc/domain";

export type WatermarkDocumentInput = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
  kind: DocumentKind;
}>;

export type WatermarkedDocument = Readonly<{
  bytes: Uint8Array;
  version: string;
  reference: string;
  watermarkedAt: Date;
}>;

export interface DocumentWatermarkProvider {
  watermark(input: WatermarkDocumentInput): Promise<WatermarkedDocument>;
}
