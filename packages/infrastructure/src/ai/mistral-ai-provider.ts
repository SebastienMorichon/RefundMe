import type { AiExtractionInput, AiExtractionResult, AiProvider } from "@lydoc/application";

export class MistralAiProvider implements AiProvider {
  constructor(private readonly apiKey: string) {}

  async extractStructuredData<TData>(
    input: AiExtractionInput,
  ): Promise<AiExtractionResult<TData>> {
    void this.apiKey;
    void input;

    throw new Error("Mistral AI adapter is not implemented yet.");
  }
}

