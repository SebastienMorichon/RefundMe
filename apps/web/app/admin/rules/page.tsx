"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@lydoc/ui";

type Rule = {
  id: string;
  status: "NEEDS_REVIEW" | "APPROVED" | string;
  name: string;
  organizer: { id: string; name: string };
  reimbursementCents: number;
  requiredDocuments: unknown;
  sourceDocument: { id: string; originalName: string; uploadedAt: string };
};

type SessionUser = { id: string; email: string; role: string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maxDocumentSizeBytes = 20 * 1024 * 1024;

export default function AdminRulesPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [message, setMessage] = useState("Verification de votre acces administrateur...");
  const [isBusy, setIsBusy] = useState(false);
  const [requiresIdentity, setRequiresIdentity] = useState(true);
  const [requiresBankDetails, setRequiresBankDetails] = useState(true);

  useEffect(() => {
    void loadAdminContext();
  }, []);

  async function loadAdminContext() {
    try {
      const response = await fetch(`${apiUrl}/auth/me`, { credentials: "include" });
      const payload = await readJson(response);
      const sessionUser = readUser(payload.user);

      if (!response.ok || !sessionUser) {
        setMessage("Connectez-vous d'abord avec un compte administrateur.");
        return;
      }

      setUser(sessionUser);
      if (sessionUser.role !== "ADMIN") {
        setMessage("Ce compte n'a pas les droits administrateur.");
        return;
      }

      await refreshRules();
      setMessage("Vous pouvez creer ou valider un reglement.");
    } catch {
      setMessage("L'API Lydoc est indisponible.");
    }
  }

  async function refreshRules() {
    const response = await fetch(`${apiUrl}/admin/rules`, { credentials: "include" });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new Error(errorMessage(payload, "Impossible de charger les reglements."));
    }

    if (Array.isArray(payload.rules)) {
      setRules(payload.rules.flatMap((rule) => {
        const parsedRule = readRule(rule);
        return parsedRule ? [parsedRule] : [];
      }));
    }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const sourceFile = formData.get("source") as File | null;
    const organizerName = String(formData.get("organizerName") ?? "");
    const name = String(formData.get("name") ?? "");
    const reimbursementEuros = Number(formData.get("reimbursementEuros"));

    if (!sourceFile || sourceFile.size === 0) {
      setMessage("Choisissez le PDF du reglement.");
      return;
    }

    if (sourceFile.type !== "application/pdf" || sourceFile.size > maxDocumentSizeBytes) {
      setMessage("Le reglement doit etre un PDF de 20 Mo maximum.");
      return;
    }

    if (!Number.isFinite(reimbursementEuros) || reimbursementEuros < 0) {
      setMessage("Indiquez un montant estimatif valide.");
      return;
    }

    setIsBusy(true);
    setMessage("Depot du PDF source...");

    try {
      const uploadResponse = await fetch(`${apiUrl}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "GAME_RULE_PDF",
          originalName: sourceFile.name,
          mimeType: sourceFile.type,
          contentBase64: await fileToBase64(sourceFile),
        }),
      });
      const uploadPayload = await readJson(uploadResponse);
      const documentId = readDocumentId(uploadPayload.document);

      if (!uploadResponse.ok || !documentId) {
        throw new Error(errorMessage(uploadPayload, "Impossible de deposer le PDF."));
      }

      setMessage("Creation de la regle en relecture...");
      const requiredDocuments = [
        { kind: "ORANGE_INVOICE", label: "Facture Orange", required: true },
        ...(requiresIdentity
          ? [{ kind: "IDENTITY_DOCUMENT", label: "Copie d'identite filigranee", required: true }]
          : []),
        ...(requiresBankDetails
          ? [{ kind: "BANK_DETAILS", label: "RIB", required: true }]
          : []),
      ];
      const ruleResponse = await fetch(`${apiUrl}/admin/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sourceDocumentId: documentId,
          organizerName,
          name,
          reimbursementCents: Math.round(reimbursementEuros * 100),
          requiredDocuments,
          constraints: {},
        }),
      });
      const rulePayload = await readJson(ruleResponse);

      if (!ruleResponse.ok) {
        throw new Error(errorMessage(rulePayload, "Impossible de creer le reglement."));
      }

      form.reset();
      setRequiresIdentity(true);
      setRequiresBankDetails(true);
      await refreshRules();
      setMessage("Reglement cree. Verifiez-le puis approuvez-le.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setIsBusy(false);
    }
  }

  async function approveRule(ruleId: string) {
    setIsBusy(true);
    setMessage("Validation du reglement...");

    try {
      const response = await fetch(`${apiUrl}/admin/rules/${ruleId}/approve`, {
        method: "PATCH",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Impossible d'approuver le reglement."));
      }

      await refreshRules();
      setMessage("Reglement approuve. Il peut maintenant servir aux dossiers clients.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setIsBusy(false);
    }
  }

  const canManageRules = user?.role === "ADMIN";

  return (
    <main className="min-h-screen bg-[#f8faff] px-6 py-8 text-[#080d2b]">
      <div className="mx-auto max-w-5xl">
        <a href="/dashboard" className="text-sm font-semibold text-[#5147f5]">
          Retour au tableau de bord
        </a>
        <h1 className="mt-6 text-3xl font-bold">Reglements</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#52607a]">
          Chaque reglement doit etre relu puis approuve avant d'etre utilise pour un dossier.
        </p>
        <div className="mt-5 rounded-md border border-[#dfe5f4] bg-white p-4 text-sm text-[#52607a]">
          {message}
        </div>

        {canManageRules ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <form onSubmit={createRule} className="rounded-lg border border-[#dfe5f4] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Nouveau reglement</h2>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                PDF source
                <input name="source" type="file" accept="application/pdf" className="font-normal" />
              </label>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                Organisateur
                <input name="organizerName" required className="rounded-md border border-[#dfe5f4] px-3 py-2 font-normal" placeholder="Orange" />
              </label>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                Nom de l'operation
                <input name="name" required className="rounded-md border border-[#dfe5f4] px-3 py-2 font-normal" placeholder="Jeu TV - avril 2026" />
              </label>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                Montant estimatif (EUR)
                <input name="reimbursementEuros" type="number" min="0" step="0.01" required className="rounded-md border border-[#dfe5f4] px-3 py-2 font-normal" />
              </label>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={requiresIdentity} onChange={(event) => setRequiresIdentity(event.target.checked)} />
                Demander une copie d'identite filigranee
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={requiresBankDetails} onChange={(event) => setRequiresBankDetails(event.target.checked)} />
                Demander un RIB
              </label>
              <div className="mt-5"><Button disabled={isBusy}>Creer pour relecture</Button></div>
            </form>

            <section className="rounded-lg border border-[#dfe5f4] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">File de relecture</h2>
              <div className="mt-4 grid gap-3">
                {rules.length === 0 ? <p className="text-sm text-[#52607a]">Aucun reglement cree.</p> : rules.map((rule) => (
                  <article key={rule.id} className="rounded-md border border-[#edf0f7] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">{rule.name}</p>
                        <p className="mt-1 text-sm text-[#52607a]">{rule.organizer.name} - {formatEuros(rule.reimbursementCents)}</p>
                      </div>
                      <span className={rule.status === "APPROVED" ? "text-sm font-semibold text-[#087f3f]" : "text-sm font-semibold text-[#9b6500]"}>
                        {rule.status === "APPROVED" ? "Approuve" : "A relire"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-[#52607a]">Source: {rule.sourceDocument.originalName}</p>
                    {rule.status === "NEEDS_REVIEW" ? (
                      <div className="mt-4"><Button type="button" disabled={isBusy} onClick={() => approveRule(rule.id)}>Approuver</Button></div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Impossible de lire le PDF."));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Impossible de lire le PDF."));
    reader.readAsDataURL(file);
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.message === "string" ? payload.message : fallback;
}

function readUser(value: unknown): SessionUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string" && typeof user.email === "string" && typeof user.role === "string"
    ? { id: user.id, email: user.email, role: user.role }
    : null;
}

function readDocumentId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}

function readRule(value: unknown): Rule | null {
  if (!value || typeof value !== "object") return null;
  const rule = value as Record<string, unknown>;
  const organizer = rule.organizer as Record<string, unknown> | undefined;
  const sourceDocument = rule.sourceDocument as Record<string, unknown> | undefined;

  if (
    typeof rule.id !== "string" ||
    typeof rule.status !== "string" ||
    typeof rule.name !== "string" ||
    typeof rule.reimbursementCents !== "number" ||
    !organizer ||
    typeof organizer.id !== "string" ||
    typeof organizer.name !== "string" ||
    !sourceDocument ||
    typeof sourceDocument.id !== "string" ||
    typeof sourceDocument.originalName !== "string" ||
    typeof sourceDocument.uploadedAt !== "string"
  ) {
    return null;
  }

  return {
    id: rule.id,
    status: rule.status,
    name: rule.name,
    organizer: { id: organizer.id, name: organizer.name },
    reimbursementCents: rule.reimbursementCents,
    requiredDocuments: rule.requiredDocuments,
    sourceDocument: {
      id: sourceDocument.id,
      originalName: sourceDocument.originalName,
      uploadedAt: sourceDocument.uploadedAt,
    },
  };
}

function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}
