export type AiExtractionInput = Readonly<{
  documentText: string;
  locale: "fr-FR";
  instruction: string;
}>;

export type AiExtractionResult<TData> = Readonly<{
  data: TData;
  provider: string;
  confidence?: number;
  raw: unknown;
}>;

export interface AiProvider {
  extractStructuredData<TData>(
    input: AiExtractionInput,
  ): Promise<AiExtractionResult<TData>>;
}

