"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@lydoc/ui";

type User = {
  id: string;
  email: string;
  role: string;
};

type UploadedDocument = {
  id: string;
  kind: string;
  status: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  encrypted: boolean;
};

type AdministrativeCase = {
  id: string;
  status: string;
  estimatedRecoverableCents: number;
  serviceFeeCents: number;
  confidence: number | null;
  rule: { id: string; name: string; organizer: string } | null;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maxDocumentSizeBytes = 20 * 1024 * 1024;

export default function DashboardPage() {
  const [email, setEmail] = useState("demo@lydoc.fr");
  const [password, setPassword] = useState("motdepasse-demo");
  const [user, setUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [cases, setCases] = useState<AdministrativeCase[]>([]);
  const [message, setMessage] = useState("Creez un compte local pour tester l'upload.");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void loadSession();
  }, []);

  async function loadSession() {
    try {
      const response = await fetch(`${apiUrl}/auth/me`, {
        credentials: "include",
      });

      if (!response.ok) {
        return;
      }

      const payload = await readJson(response);
      const sessionUser = readUser(payload.user);
      if (!sessionUser) {
        throw new Error("Session invalide.");
      }

      setUser(sessionUser);
      setMessage("Session active. Vous pouvez deposer un document.");
      await refreshDocuments();
      await refreshCases();
    } catch {
      setMessage("Creez un compte ou connectez-vous pour tester l'upload.");
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("Creation du compte...");

    try {
      const response = await fetch(`${apiUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "Impossible de creer le compte."));
      }

      const registeredUser = readUser(payload.user);
      if (!registeredUser) {
        throw new Error("La reponse de creation de compte est invalide.");
      }

      setUser(registeredUser);
      setMessage("Compte cree. Vous pouvez deposer un document.");
      await refreshDocuments();
      await refreshCases();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setIsBusy(false);
    }
  }

  async function login() {
    setIsBusy(true);
    setMessage("Connexion...");

    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "Connexion impossible."));
      }

      const authenticatedUser = readUser(payload.user);
      if (!authenticatedUser) {
        throw new Error("La reponse de connexion est invalide.");
      }

      setUser(authenticatedUser);
      setMessage("Connexion reussie. Vous pouvez deposer un document.");
      await refreshDocuments();
      await refreshCases();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setIsBusy(false);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("document") as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      setMessage("Choisissez un document PDF, PNG ou JPG.");
      return;
    }

    if (file.size > maxDocumentSizeBytes) {
      setMessage("Le document ne doit pas depasser 20 Mo.");
      return;
    }

    if (!file.type) {
      setMessage("Le format du document est introuvable. Choisissez un PDF, PNG ou JPG.");
      return;
    }

    setIsBusy(true);
    setMessage("Chiffrement et depot du document...");

    try {
      const response = await fetch(`${apiUrl}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "ORANGE_INVOICE",
          originalName: file.name,
          mimeType: file.type,
          contentBase64: await fileToBase64(file),
        }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "Upload impossible."));
      }

      const uploadedDocument = readDocument(payload.document);
      if (!uploadedDocument) {
        throw new Error("La reponse de depot est invalide.");
      }

      setDocuments((current) => [uploadedDocument, ...current]);
      setMessage("Document depose et stocke chiffre.");
      form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshDocuments() {
    try {
      const response = await fetch(`${apiUrl}/documents`, {
        credentials: "include",
      });
      const payload = await readJson(response);

      if (response.ok && Array.isArray(payload.documents)) {
        setDocuments(payload.documents.flatMap((document) => {
          const parsedDocument = readDocument(document);
          return parsedDocument ? [parsedDocument] : [];
        }));
      }
    } catch {
      // A failed refresh must not invalidate an otherwise successful login or upload.
    }
  }

  async function refreshCases() {
    try {
      const response = await fetch(`${apiUrl}/cases`, { credentials: "include" });
      const payload = await readJson(response);

      if (response.ok && Array.isArray(payload.cases)) {
        setCases(payload.cases.flatMap((administrativeCase) => {
          const parsedCase = readCase(administrativeCase);
          return parsedCase ? [parsedCase] : [];
        }));
      }
    } catch {
      // A failed refresh must not hide documents already visible to the user.
    }
  }

  async function analyzeInvoice(documentId: string) {
    setIsBusy(true);
    setMessage("Analyse de la facture et recherche des reglements approuves...");

    try {
      const response = await fetch(`${apiUrl}/documents/${documentId}/analyze`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "Analyse impossible."));
      }

      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      await refreshDocuments();
      await refreshCases();
      setMessage(
        candidates.length > 0
          ? "Reglement correspondant trouve. Un dossier brouillon a ete cree."
          : "Aucun reglement approuve ne correspond avec suffisamment d'elements.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8faff] px-6 py-8 text-[#080d2b]">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section>
          <a href="/" className="text-sm font-semibold text-[#5147f5]">
            Lydoc
          </a>
          {user?.role === "ADMIN" ? (
            <a href="/admin/rules" className="mt-3 inline-block text-sm font-semibold text-[#5147f5]">
              Gerer les reglements
            </a>
          ) : null}
          <h1 className="mt-8 text-4xl font-bold leading-tight">
            Deposez une facture Orange.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[#52607a]">
            Deposez une facture Orange, lancez l'analyse et consultez les dossiers brouillon
            issus des reglements approuves par l'equipe Lydoc.
          </p>
          <div className="mt-6 rounded-md border border-[#dfe5f4] bg-white p-4 text-sm text-[#52607a]">
            {message}
          </div>
        </section>

        <section className="grid gap-4">
          <form
            onSubmit={register}
            className="rounded-lg border border-[#dfe5f4] bg-white p-5 shadow-sm"
          >
            <h2 className="text-lg font-bold">Compte local</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="rounded-md border border-[#dfe5f4] px-3 py-2 font-normal"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Mot de passe
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  className="rounded-md border border-[#dfe5f4] px-3 py-2 font-normal"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button disabled={isBusy}>{user ? "Compte actif" : "Creer le compte"}</Button>
              <Button type="button" variant="secondary" disabled={isBusy} onClick={login}>
                Se connecter
              </Button>
            </div>
          </form>

          <form
            onSubmit={uploadDocument}
            className="rounded-lg border border-[#dfe5f4] bg-white p-5 shadow-sm"
          >
            <h2 className="text-lg font-bold">Depot document</h2>
            <p className="mt-2 text-sm text-[#52607a]">
              Formats acceptes : PDF, PNG, JPG. Taille maximale : 20 Mo.
            </p>
            <input
              name="document"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="mt-4 w-full rounded-md border border-dashed border-[#b9c3f8] bg-[#fbfcff] p-4 text-sm"
            />
            <div className="mt-4">
              <Button disabled={isBusy || !user}>Deposer le document</Button>
            </div>
          </form>

          <section className="rounded-lg border border-[#dfe5f4] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Documents</h2>
            <div className="mt-4 grid gap-3">
              {documents.length === 0 ? (
                <p className="text-sm text-[#52607a]">Aucun document depose.</p>
              ) : (
                documents.map((document) => (
                  <article
                    key={document.id}
                    className="rounded-md border border-[#edf0f7] p-4 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{document.originalName}</p>
                      <span className="rounded-full bg-[#e9fbf0] px-3 py-1 text-xs font-semibold text-[#087f3f]">
                        Chiffre
                      </span>
                    </div>
                    <p className="mt-2 text-[#52607a]">
                      {document.kind} - {document.status} - {formatBytes(document.sizeBytes)}
                    </p>
                    {document.kind === "ORANGE_INVOICE" ? (
                      <div className="mt-3">
                        <Button type="button" disabled={isBusy} onClick={() => analyzeInvoice(document.id)}>
                          Analyser la facture
                        </Button>
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[#dfe5f4] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Mes dossiers</h2>
            <div className="mt-4 grid gap-3">
              {cases.length === 0 ? (
                <p className="text-sm text-[#52607a]">Aucun dossier en preparation.</p>
              ) : (
                cases.map((administrativeCase) => (
                  <article key={administrativeCase.id} className="rounded-md border border-[#edf0f7] p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold">{administrativeCase.rule?.name ?? "Dossier administratif"}</p>
                      <span className="rounded-full bg-[#eef1ff] px-3 py-1 text-xs font-semibold text-[#5147f5]">
                        {formatCaseStatus(administrativeCase.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-[#52607a]">
                      Montant estimatif recuperable: {formatCents(administrativeCase.estimatedRecoverableCents)}
                    </p>
                    {administrativeCase.confidence !== null ? (
                      <p className="mt-1 text-[#52607a]">Niveau de confiance: {Math.round(administrativeCase.confidence * 100)}%</p>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Impossible de lire le document."));
        return;
      }

      const separator = result.indexOf(",");
      if (separator === -1) {
        reject(new Error("Impossible de preparer le document."));
        return;
      }

      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error("Impossible de lire le document."));
    reader.readAsDataURL(file);
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (Array.isArray(payload.message) && payload.message.every((message) => typeof message === "string")) {
    return payload.message.join(" ");
  }

  return fallback;
}

function readUser(value: unknown): User | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const user = value as Record<string, unknown>;
  return typeof user.id === "string" && typeof user.email === "string" && typeof user.role === "string"
    ? { id: user.id, email: user.email, role: user.role }
    : null;
}

function readDocument(value: unknown): UploadedDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const document = value as Record<string, unknown>;
  return (
    typeof document.id === "string" &&
    typeof document.kind === "string" &&
    typeof document.status === "string" &&
    typeof document.originalName === "string" &&
    typeof document.mimeType === "string" &&
    typeof document.sizeBytes === "number" &&
    typeof document.encrypted === "boolean"
  )
    ? {
        id: document.id,
        kind: document.kind,
        status: document.status,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        encrypted: document.encrypted,
      }
    : null;
}

function readCase(value: unknown): AdministrativeCase | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const administrativeCase = value as Record<string, unknown>;
  const rule = administrativeCase.rule;
  const parsedRule = rule && typeof rule === "object"
    ? rule as Record<string, unknown>
    : null;

  if (
    typeof administrativeCase.id !== "string" ||
    typeof administrativeCase.status !== "string" ||
    typeof administrativeCase.estimatedRecoverableCents !== "number" ||
    typeof administrativeCase.serviceFeeCents !== "number" ||
    (administrativeCase.confidence !== null && typeof administrativeCase.confidence !== "number") ||
    (parsedRule && (typeof parsedRule.id !== "string" || typeof parsedRule.name !== "string" || typeof parsedRule.organizer !== "string"))
  ) {
    return null;
  }

  return {
    id: administrativeCase.id,
    status: administrativeCase.status,
    estimatedRecoverableCents: administrativeCase.estimatedRecoverableCents,
    serviceFeeCents: administrativeCase.serviceFeeCents,
    confidence: administrativeCase.confidence as number | null,
    rule: parsedRule
      ? { id: parsedRule.id as string, name: parsedRule.name as string, organizer: parsedRule.organizer as string }
      : null,
  };
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} o`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} Ko`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} Mo`;
}

function formatCents(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

function formatCaseStatus(status: string): string {
  return status === "DRAFT" ? "Brouillon" : status;
}
