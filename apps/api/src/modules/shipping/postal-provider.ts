import { ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";

export type PostalAddress = Readonly<{
  firstName?: string;
  lastName?: string;
  company?: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  country: string;
}>;

export type PostalPreviewInput = Readonly<{
  caseId: string;
  product: "verte" | "vertesuivi";
  sender: PostalAddress;
  recipient: PostalAddress;
  pdf: Buffer;
}>;

export type PostalQuote = Readonly<{
  provider: string;
  environment: string;
  uid: string;
  postageCents: number;
  serviceCents: number;
  totalCents: number;
  previewUrl: string | null;
}>;

export type PostalTracking = Readonly<{
  trackingNumber: string | null;
  events: Array<{ code: string; message: string; date: string | null }>;
}>;

export interface PostalProvider {
  readonly name: string;
  readonly environment: string;
  preview(input: PostalPreviewInput): Promise<PostalQuote>;
  submit(uid: string, reference: string): Promise<void>;
  tracking(uid: string): Promise<PostalTracking>;
}

export function createPostalProvider(): PostalProvider {
  const configured = (process.env.POSTAL_PROVIDER ?? "mock").trim().toLowerCase();
  if (configured !== "service_postal") return new MockPostalProvider();
  const apiKey = process.env.SERVICE_POSTAL_API_KEY?.trim();
  if (!apiKey) {
    throw new ServiceUnavailableException("SERVICE_POSTAL_API_KEY n'est pas configuree.");
  }
  const environment = (process.env.SERVICE_POSTAL_ENV ?? "sandbox").trim().toLowerCase();
  if (environment === "production" && process.env.SERVICE_POSTAL_PRODUCTION_ENABLED !== "true") {
    throw new ServiceUnavailableException("L'envoi postal en production n'est pas explicitement active.");
  }
  return new ServicePostalProvider(apiKey, environment === "production" ? "production" : "sandbox");
}

class MockPostalProvider implements PostalProvider {
  readonly name = "mock";
  readonly environment = "sandbox";

  async preview(input: PostalPreviewInput): Promise<PostalQuote> {
    const pages = (await PDFDocument.load(input.pdf)).getPageCount();
    const postageCents = input.product === "vertesuivi" ? 202 : 152;
    const serviceCents = 90 + Math.max(0, pages - 1) * 31;
    return {
      provider: this.name,
      environment: this.environment,
      uid: `mock-${randomUUID()}`,
      postageCents,
      serviceCents,
      totalCents: postageCents + serviceCents,
      previewUrl: null,
    };
  }

  async submit(): Promise<void> {}

  async tracking(): Promise<PostalTracking> {
    return { trackingNumber: null, events: [{ code: "soumis", message: "Courrier accepte en simulation", date: new Date().toISOString() }] };
  }
}

class ServicePostalProvider implements PostalProvider {
  readonly name = "service_postal";
  readonly environment: "sandbox" | "production";
  private readonly baseUrl: string;

  constructor(private readonly apiKey: string, environment: "sandbox" | "production") {
    this.environment = environment;
    this.baseUrl = environment === "production"
      ? "https://prod-api.servicepostal.com"
      : "https://sandbox-api.servicepostal.com";
  }

  async preview(input: PostalPreviewInput): Promise<PostalQuote> {
    const response = await this.request<Record<string, unknown>>("/lettres/previsualiser", {
      method: "POST",
      body: JSON.stringify({
        type_affranchissement: input.product,
        couleur: "nb",
        recto_verso: "rectoverso",
        placement_adresse: "insertion_page_adresse",
        surimpression_adresses_document: true,
        impression_expediteur: true,
        ar_scan: false,
        reference: input.caseId.slice(0, 50),
        adresse_expedition: presentAddress(input.sender),
        adresse_destination: presentAddress(input.recipient),
        variables: null,
        fichier: { format: "pdf", contenu_base64: input.pdf.toString("base64") },
        fichier_annexes: null,
      }),
    });
    const uid = readString(response.uid);
    if (!uid) throw new ServiceUnavailableException("Service Postal n'a pas retourne d'identifiant de courrier.");
    return {
      provider: this.name,
      environment: this.environment,
      uid,
      postageCents: eurosToCents(response.affranchissement),
      serviceCents: eurosToCents(response.service),
      totalCents: eurosToCents(response.total),
      previewUrl: readNestedUrl(response.fichier_previsualisation),
    };
  }

  async submit(uid: string, reference: string): Promise<void> {
    await this.request(`/lettres/${encodeURIComponent(uid)}/valider`, {
      method: "POST",
      body: JSON.stringify({ reference: reference.slice(0, 50) }),
    });
  }

  async tracking(uid: string): Promise<PostalTracking> {
    const response = await this.request<Record<string, unknown>>(`/lettres/${encodeURIComponent(uid)}/suivi`, { method: "GET" });
    const rawEvents = Array.isArray(response.evenements) ? response.evenements : [];
    return {
      trackingNumber: readString(response.numero_suivi_laposte),
      events: rawEvents.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const event = value as Record<string, unknown>;
        const code = readString(event.code_statut);
        const message = readString(event.message_statut);
        return code && message ? [{ code, message, date: readString(event.date_statut) }] : [];
      }),
    };
  }

  private async request<T = Record<string, unknown>>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", apiKey: this.apiKey },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ServiceUnavailableException("Service Postal est momentanement indisponible.");
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(readString(payload.message) || `Service Postal a retourne l'erreur ${response.status}.`);
    }
    return payload as T;
  }
}

function presentAddress(address: PostalAddress) {
  return {
    civilite: null,
    prenom: address.firstName ?? null,
    nom: address.lastName ?? null,
    nom_societe: address.company ?? null,
    adresse_ligne1: address.addressLine1,
    adresse_ligne2: address.addressLine2 ?? null,
    code_postal: address.postalCode,
    ville: address.city,
    pays: address.country,
  };
}

function eurosToCents(value: unknown): number {
  const amount = typeof value === "number" ? value : Number.parseFloat(readString(value).replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) throw new ServiceUnavailableException("Le prix postal retourne est invalide.");
  return Math.round(amount * 100);
}

function readNestedUrl(value: unknown): string | null {
  return value && typeof value === "object" ? readString((value as Record<string, unknown>).url) || null : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
