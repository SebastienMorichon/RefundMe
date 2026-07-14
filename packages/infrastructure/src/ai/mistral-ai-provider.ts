import type { AiExtractionInput, AiExtractionResult, AiProvider } from "@lydoc/application";

export class MistralAiProvider implements AiProvider {
  constructor(private readonly apiKey: string) {}

  async extractStructuredData<TData>(
    input: AiExtractionInput,
  ): Promise<AiExtractionResult<TData>> {
    if (!this.apiKey || this.apiKey === "change_me") {
      throw new Error("MISTRAL_API_KEY doit etre configuree pour utiliser l'analyse IA.");
    }

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Tu extrais des informations administratives depuis un reglement. Tu reponds uniquement par un objet JSON. N'invente jamais une information: utilise null, une chaine vide ou un tableau vide si elle n'est pas explicitement presente.",
          },
          {
            role: "user",
            content: `${input.instruction}\n\nTexte OCR du reglement:\n${input.documentText}`,
          },
        ],
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Mistral AI a refuse l'analyse (HTTP ${response.status}).`);
    }

    const content = readContent(payload);
    if (!content) {
      throw new Error("Mistral AI n'a retourne aucune analyse exploitable.");
    }

    try {
      return {
        data: JSON.parse(content) as TData,
        provider: "mistral-small-latest",
        raw: readUsage(payload),
      };
    } catch {
      throw new Error("Mistral AI a retourne une analyse JSON invalide.");
    }
  }
}

function readContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return null;
  }

  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

function readUsage(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const usage = (payload as Record<string, unknown>).usage;
  return usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
}
