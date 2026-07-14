"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@lydoc/ui";
import { AppShell } from "../../../components/app-shell";

type Rule = {
  id: string;
  status: "NEEDS_REVIEW" | "APPROVED" | string;
  name: string;
  organizer: { id: string; name: string };
  reimbursementCents: number;
  requiredDocuments: unknown;
  constraints: Record<string, unknown>;
  validFrom: string | null;
  validUntil: string | null;
  sourceDocument: { id: string; originalName: string; uploadedAt: string };
};

type SessionUser = { id: string; email: string; role: string };

type RuleCandidate = {
  sourceDocumentId: string;
  organizerName: string;
  name: string;
  reimbursementCents: number;
  requiredDocuments: Array<{ kind: string; label: string; required: boolean }>;
  constraints: Record<string, unknown>;
  validFrom?: string;
  validUntil?: string;
  confidence: number;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maxDocumentSizeBytes = 20 * 1024 * 1024;

export default function AdminRulesPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [message, setMessage] = useState("Verification de votre acces administrateur...");
  const [isBusy, setIsBusy] = useState(false);
  const [requiresIdentity, setRequiresIdentity] = useState(true);
  const [requiresBankDetails, setRequiresBankDetails] = useState(true);
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [organizerName, setOrganizerName] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [reimbursementEuros, setReimbursementEuros] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [gameDate, setGameDate] = useState("");
  const [constraints, setConstraints] = useState<Record<string, unknown>>({});
  const [conditionsText, setConditionsText] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

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
    setIsBusy(true);

    try {
      if (!sourceDocumentId) {
        if (!sourceFile || sourceFile.size === 0) {
          throw new Error("Choisissez le PDF du reglement.");
        }
        if (sourceFile.type !== "application/pdf" || sourceFile.size > maxDocumentSizeBytes) {
          throw new Error("Le reglement doit etre un PDF de 20 Mo maximum.");
        }

        setMessage("Depot et analyse OCR du reglement...");
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

        const extractionResponse = await fetch(`${apiUrl}/admin/rules/extract/${documentId}`, {
          method: "POST",
          credentials: "include",
        });
        const extractionPayload = await readJson(extractionResponse);
        const candidate = readRuleCandidate(extractionPayload.candidate);
        if (!extractionResponse.ok || !candidate) {
          throw new Error(errorMessage(extractionPayload, "Impossible d'analyser le reglement."));
        }

        setSourceDocumentId(candidate.sourceDocumentId);
        setOrganizerName(candidate.organizerName);
        setRuleName(candidate.name);
        setReimbursementEuros((candidate.reimbursementCents / 100).toFixed(2));
        setValidFrom(candidate.validFrom?.slice(0, 10) ?? "");
        setValidUntil(candidate.validUntil?.slice(0, 10) ?? "");
        setGameDate(readString(candidate.constraints.gameDate)?.slice(0, 10) ?? "");
        setConstraints(candidate.constraints);
        setConditionsText(formatConditions(candidate.constraints));
        setRequiresIdentity(candidate.requiredDocuments.some((document) => document.kind === "IDENTITY_DOCUMENT"));
        setRequiresBankDetails(candidate.requiredDocuments.some((document) => document.kind === "BANK_DETAILS"));
        setMessage("Fiche pre-remplie par Mistral. Relisez les champs puis creez le reglement.");
        return;
      }

      const reimbursement = Number(reimbursementEuros);
      if (!organizerName.trim() || !ruleName.trim() || !Number.isFinite(reimbursement) || reimbursement < 0) {
        throw new Error("Verifiez l'organisateur, le nom et le montant avant de creer le reglement.");
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
      const ruleResponse = await fetch(
        editingRuleId ? `${apiUrl}/admin/rules/${editingRuleId}` : `${apiUrl}/admin/rules`,
        {
        method: editingRuleId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sourceDocumentId,
          organizerName,
          name: ruleName,
          reimbursementCents: Math.round(reimbursement * 100),
          requiredDocuments,
          constraints: {
            ...constraints,
            conditions: parseConditions(conditionsText),
            ...(gameDate ? { gameDate } : {}),
          },
          ...(validFrom ? { validFrom } : {}),
          ...(validUntil ? { validUntil } : {}),
        }),
        },
      );
      const rulePayload = await readJson(ruleResponse);

      if (!ruleResponse.ok) {
        throw new Error(errorMessage(rulePayload, "Impossible de creer le reglement."));
      }

      form.reset();
      setRequiresIdentity(true);
      setRequiresBankDetails(true);
      setSourceDocumentId(null);
      setOrganizerName("");
      setRuleName("");
      setReimbursementEuros("");
      setValidFrom("");
      setValidUntil("");
      setGameDate("");
      setConstraints({});
      setConditionsText("");
      setEditingRuleId(null);
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

  function editRule(rule: Rule) {
    setEditingRuleId(rule.id);
    setSourceDocumentId(rule.sourceDocument.id);
    setOrganizerName(rule.organizer.name);
    setRuleName(rule.name);
    setReimbursementEuros((rule.reimbursementCents / 100).toFixed(2));
    setValidFrom(rule.validFrom?.slice(0, 10) ?? "");
    setValidUntil(rule.validUntil?.slice(0, 10) ?? "");
    setGameDate(readString(rule.constraints.gameDate)?.slice(0, 10) ?? "");
    setConstraints(rule.constraints);
    setConditionsText(formatConditions(rule.constraints));
    const requiredDocuments = Array.isArray(rule.requiredDocuments) ? rule.requiredDocuments : [];
    setRequiresIdentity(requiredDocuments.some((document) => isRequiredDocument(document, "IDENTITY_DOCUMENT")));
    setRequiresBankDetails(requiredDocuments.some((document) => isRequiredDocument(document, "BANK_DETAILS")));
    setMessage("Fiche chargee. Toute modification d'un reglement approuve le remettra en relecture.");
  }

  const canManageRules = user?.role === "ADMIN";

  return (
    <AppShell active="admin" email={user?.email} isAdmin>
      <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <p className="text-xs font-extrabold uppercase text-[#7a8499]">Administration</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#102544]">Règlements des jeux</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667189]">
          Chaque règlement est analysé, relu puis approuvé avant d’être utilisé pour un dossier client.
        </p>
        <div className="mt-5 border-l-4 border-[#2457f5] bg-[#eef3ff] p-4 text-sm text-[#344f8d]">
          {message}
        </div>

        {canManageRules ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <form onSubmit={createRule} className="surface p-5 sm:p-6">
              <h2 className="text-lg font-extrabold text-[#102544]">Nouveau règlement</h2>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                PDF source
                <input name="source" type="file" accept="application/pdf" disabled={editingRuleId !== null} className="field font-normal file:mr-3 file:rounded-md file:border-0 file:bg-[#e8efff] file:px-3 file:py-1 file:text-xs file:font-extrabold file:text-[#2457f5]" />
              </label>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                Organisateur
                <input name="organizerName" value={organizerName} onChange={(event) => setOrganizerName(event.target.value)} required className="field font-normal" placeholder="Orange" />
              </label>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                Nom de l'operation
                <input name="name" value={ruleName} onChange={(event) => setRuleName(event.target.value)} required className="field font-normal" placeholder="Jeu TV - avril 2026" />
              </label>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                Montant estimatif (EUR)
                <input name="reimbursementEuros" value={reimbursementEuros} onChange={(event) => setReimbursementEuros(event.target.value)} type="number" min="0" step="0.01" required className="field font-normal" />
              </label>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="grid gap-2 text-sm font-semibold">Date du jeu<input value={gameDate} onChange={(event) => setGameDate(event.target.value)} type="date" className="field font-normal" /></label>
                <label className="grid gap-2 text-sm font-semibold">Début de validité<input value={validFrom} onChange={(event) => setValidFrom(event.target.value)} type="date" className="field font-normal" /></label>
                <label className="grid gap-2 text-sm font-semibold">Fin de validité<input value={validUntil} onChange={(event) => setValidUntil(event.target.value)} type="date" className="field font-normal" /></label>
              </div>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={requiresIdentity} onChange={(event) => setRequiresIdentity(event.target.checked)} />
                Demander une copie d'identite filigranee
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={requiresBankDetails} onChange={(event) => setRequiresBankDetails(event.target.checked)} />
                Demander un RIB
              </label>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                Conditions du jeu et du remboursement
                <textarea value={conditionsText} onChange={(event) => setConditionsText(event.target.value)} rows={5} className="field font-normal" placeholder="Éligibilité: ...&#10;Remboursement: ..." />
              </label>
              <div className="mt-5"><Button disabled={isBusy}>{sourceDocumentId ? (editingRuleId ? "Enregistrer les modifications" : "Creer pour relecture") : "Analyser le PDF"}</Button></div>
            </form>

            <section className="surface p-5 sm:p-6">
              <h2 className="text-lg font-extrabold text-[#102544]">File de relecture</h2>
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
                    {readString(rule.constraints.gameDate) ? <p className="mt-2 text-sm text-[#52607a]">Date du jeu: {readString(rule.constraints.gameDate)}</p> : null}
                    {formatConditions(rule.constraints) ? <p className="mt-2 whitespace-pre-line text-sm text-[#52607a]">{formatConditions(rule.constraints)}</p> : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button type="button" variant="secondary" disabled={isBusy} onClick={() => editRule(rule)}>Modifier</Button>
                    {rule.status === "NEEDS_REVIEW" ? (
                      <Button type="button" disabled={isBusy} onClick={() => approveRule(rule.id)}>Approuver</Button>
                    ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </AppShell>
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

function readRuleCandidate(value: unknown): RuleCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sourceDocumentId !== "string" ||
    typeof candidate.organizerName !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.reimbursementCents !== "number" ||
    !Array.isArray(candidate.requiredDocuments) ||
    !candidate.constraints ||
    typeof candidate.constraints !== "object" ||
    Array.isArray(candidate.constraints) ||
    typeof candidate.confidence !== "number"
  ) {
    return null;
  }

  const requiredDocuments = candidate.requiredDocuments.flatMap((document) => {
    if (!document || typeof document !== "object") return [];
    const requiredDocument = document as Record<string, unknown>;
    return typeof requiredDocument.kind === "string" && typeof requiredDocument.label === "string" && typeof requiredDocument.required === "boolean"
      ? [{ kind: requiredDocument.kind, label: requiredDocument.label, required: requiredDocument.required }]
      : [];
  });

  return {
    sourceDocumentId: candidate.sourceDocumentId,
    organizerName: candidate.organizerName,
    name: candidate.name,
    reimbursementCents: candidate.reimbursementCents,
    requiredDocuments,
    constraints: candidate.constraints as Record<string, unknown>,
    ...(typeof candidate.validFrom === "string" ? { validFrom: candidate.validFrom } : {}),
    ...(typeof candidate.validUntil === "string" ? { validUntil: candidate.validUntil } : {}),
    confidence: candidate.confidence,
  };
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
    !rule.constraints ||
    typeof rule.constraints !== "object" ||
    Array.isArray(rule.constraints) ||
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
    constraints: rule.constraints as Record<string, unknown>,
    validFrom: typeof rule.validFrom === "string" ? rule.validFrom : null,
    validUntil: typeof rule.validUntil === "string" ? rule.validUntil : null,
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

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRequiredDocument(value: unknown, kind: string): boolean {
  if (!value || typeof value !== "object") return false;
  const document = value as Record<string, unknown>;
  return document.kind === kind && document.required === true;
}

function formatConditions(constraints: Record<string, unknown>): string {
  const conditions = constraints.conditions;
  if (!Array.isArray(conditions)) return "";

  return conditions.flatMap((condition) => {
    if (!condition || typeof condition !== "object") return [];
    const value = condition as Record<string, unknown>;
    return typeof value.title === "string" && typeof value.details === "string"
      ? [`${value.title}: ${value.details}`]
      : [];
  }).join("\n");
}

function parseConditions(value: string): Array<{ title: string; details: string }> {
  return value.split("\n").flatMap((line) => {
    const separator = line.indexOf(":");
    const title = separator === -1 ? "Condition" : line.slice(0, separator).trim();
    const details = (separator === -1 ? line : line.slice(separator + 1)).trim();
    return details ? [{ title: title || "Condition", details }] : [];
  });
}
