export type WatermarkIdentityInput = Readonly<{
  sourceStorageKey: string;
  caseId: string;
  watermarkText: string;
}>;

export type CasePacketInput = Readonly<{
  caseId: string;
  documentStorageKeys: string[];
}>;

export type GeneratedDocument = Readonly<{
  storageKey: string;
  checksumSha256: string;
}>;

export interface PdfGenerationProvider {
  watermarkIdentityCopy(input: WatermarkIdentityInput): Promise<GeneratedDocument>;
  generateCasePacket(input: CasePacketInput): Promise<GeneratedDocument>;
}

