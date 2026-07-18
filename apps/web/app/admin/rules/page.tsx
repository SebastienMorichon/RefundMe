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

type RequiredDocument = { kind: string; label: string; required: boolean };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maxDocumentSizeBytes = 20 * 1024 * 1024;

export default function AdminRulesPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [message, setMessage] = useState("Verification de votre acces administrateur...");
  const [isBusy, setIsBusy] = useState(false);
  const [requiredDocuments, setRequiredDocuments] = useState<RequiredDocument[]>([]);
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [organizerName, setOrganizerName] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [reimbursementEuros, setReimbursementEuros] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [gameDate, setGameDate] = useState("");
  const [constraints, setConstraints] = useState<Record<string, unknown>>({});
  const [conditionsText, setConditionsText] = useState("");
  const [participationMechanism, setParticipationMechanism] = useState("");
  const [participationPeriod, setParticipationPeriod] = useState("");
  const [reimbursementDeadline, setReimbursementDeadline] = useState("");
  const [reimbursementRecipient, setReimbursementRecipient] = useState("");
  const [reimbursementAddress, setReimbursementAddress] = useState("");
  const [reimbursementEmail, setReimbursementEmail] = useState("");
  const [reimbursementMethod, setReimbursementMethod] = useState("");
  const [eligibilityConditionsText, setEligibilityConditionsText] = useState("");
  const [reimbursementConditionsText, setReimbursementConditionsText] = useState("");
  const [excludedCostsText, setExcludedCostsText] = useState("");
  const [letterMentionsText, setLetterMentionsText] = useState("");
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

  async function analyzeAndCreateRule(sourceFile: File | null) {
    if (!sourceFile || sourceFile.size === 0) {
      return;
    }

    if (sourceFile.type !== "application/pdf" || sourceFile.size > maxDocumentSizeBytes) {
      setMessage("Le reglement doit etre un PDF de 20 Mo maximum.");
      return;
    }

    setIsBusy(true);

    try {
      setMessage("Import du PDF et lecture par Mistral OCR...");
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

      setMessage("Analyse des regles et des conditions de remboursement par Mistral...");
      const extractionResponse = await fetch(`${apiUrl}/admin/rules/extract/${documentId}`, {
        method: "POST",
        credentials: "include",
      });
      const extractionPayload = await readJson(extractionResponse);
      const candidate = readRuleCandidate(extractionPayload.candidate);
      if (!extractionResponse.ok || !candidate) {
        throw new Error(errorMessage(extractionPayload, "Impossible d'analyser le reglement."));
      }

      hydrateCandidate(candidate);

      if (!candidate.organizerName.trim() || !candidate.name.trim()) {
        setMessage("Mistral a analyse le PDF, mais le nom du jeu ou l'organisateur n'est pas explicitement indique. Completez uniquement le champ manquant pour creer la fiche.");
        return;
      }

      setMessage("Creation automatique de la fiche reglement...");
      const ruleResponse = await fetch(`${apiUrl}/admin/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(candidateToRulePayload(candidate)),
      });
      const rulePayload = await readJson(ruleResponse);
      const createdRule = readRule(rulePayload.rule);
      if (!ruleResponse.ok || !createdRule) {
        throw new Error(errorMessage(rulePayload, "Impossible de creer automatiquement la fiche."));
      }

      await refreshRules();
      editRule(createdRule);
      setMessage(`Fiche creee automatiquement par Mistral (confiance ${Math.round(candidate.confidence * 100)} %). Verifiez-la puis cliquez sur Approuver.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setIsBusy(false);
    }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setIsBusy(true);

    try {
      if (!sourceDocumentId) {
        throw new Error("Importez un PDF. Son analyse demarre automatiquement.");
      }

      const reimbursement = Number(reimbursementEuros);
      if (!organizerName.trim() || !ruleName.trim() || !Number.isFinite(reimbursement) || reimbursement < 0) {
        throw new Error("Verifiez l'organisateur, le nom et le montant avant de creer le reglement.");
      }
      if (requiredDocuments.some((document) => !document.label.trim())) {
        throw new Error("Chaque piece demandee doit avoir un libelle.");
      }

      setMessage("Creation de la regle en relecture...");
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
            participationMechanism,
            participationPeriod,
            reimbursementDeadline,
            reimbursementRecipient,
            reimbursementAddress,
            reimbursementEmail,
            reimbursementMethod,
            eligibilityConditions: parseLines(eligibilityConditionsText),
            reimbursementConditions: parseLines(reimbursementConditionsText),
            excludedCosts: parseLines(excludedCostsText),
            requiredLetterMentions: parseLines(letterMentionsText),
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
      setRequiredDocuments([]);
      setSourceDocumentId(null);
      setOrganizerName("");
      setRuleName("");
      setReimbursementEuros("");
      setValidFrom("");
      setValidUntil("");
      setGameDate("");
      setConstraints({});
      setConditionsText("");
      resetConstraintFields();
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

  async function deleteRule(rule: Rule) {
    const confirmed = window.confirm(`Supprimer le reglement "${rule.name}" ? Cette action est definitive.`);
    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    setMessage("Suppression du reglement...");

    try {
      const response = await fetch(`${apiUrl}/admin/rules/${rule.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Impossible de supprimer le reglement."));
      }

      if (editingRuleId === rule.id) {
        setRequiredDocuments([]);
        setSourceDocumentId(null);
        setOrganizerName("");
        setRuleName("");
        setReimbursementEuros("");
        setValidFrom("");
        setValidUntil("");
        setGameDate("");
        setConstraints({});
        setConditionsText("");
        resetConstraintFields();
        setEditingRuleId(null);
      }

      await refreshRules();
      setMessage("Reglement supprime.");
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
    setRequiredDocuments(readRequiredDocuments(rule.requiredDocuments));
    hydrateConstraintFields(rule.constraints);
    setMessage("Fiche chargee. Toute modification d'un reglement approuve le remettra en relecture.");
  }

  function hydrateCandidate(candidate: RuleCandidate) {
    setSourceDocumentId(candidate.sourceDocumentId);
    setOrganizerName(candidate.organizerName);
    setRuleName(candidate.name);
    setReimbursementEuros((candidate.reimbursementCents / 100).toFixed(2));
    setValidFrom(candidate.validFrom?.slice(0, 10) ?? "");
    setValidUntil(candidate.validUntil?.slice(0, 10) ?? "");
    setGameDate(readString(candidate.constraints.gameDate)?.slice(0, 10) ?? "");
    setConstraints(candidate.constraints);
    setConditionsText(formatConditions(candidate.constraints));
    setRequiredDocuments(candidate.requiredDocuments);
    hydrateConstraintFields(candidate.constraints);
  }

  function updateRequiredDocument(index: number, patch: Partial<RequiredDocument>) {
    setRequiredDocuments((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function hydrateConstraintFields(value: Record<string, unknown>) {
    setParticipationMechanism(readString(value.participationMechanism) ?? "");
    setParticipationPeriod(readString(value.participationPeriod) ?? "");
    setReimbursementDeadline(readString(value.reimbursementDeadline) ?? "");
    setReimbursementRecipient(readString(value.reimbursementRecipient) ?? "");
    setReimbursementAddress(readString(value.reimbursementAddress) ?? "");
    setReimbursementEmail(readString(value.reimbursementEmail) ?? "");
    setReimbursementMethod(readString(value.reimbursementMethod) ?? "");
    setEligibilityConditionsText(formatLines(value.eligibilityConditions));
    setReimbursementConditionsText(formatLines(value.reimbursementConditions));
    setExcludedCostsText(formatLines(value.excludedCosts));
    setLetterMentionsText(formatLines(value.requiredLetterMentions));
  }

  function resetConstraintFields() {
    hydrateConstraintFields({});
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
                <input name="source" type="file" accept="application/pdf" disabled={editingRuleId !== null || isBusy} onChange={(event) => void analyzeAndCreateRule(event.target.files?.[0] ?? null)} className="field font-normal file:mr-3 file:rounded-md file:border-0 file:bg-[#e8efff] file:px-3 file:py-1 file:text-xs file:font-extrabold file:text-[#2457f5]" />
                <span className="text-xs font-normal text-[#667189]">L'analyse OCR et la creation de la fiche demarrent automatiquement.</span>
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
              <fieldset className="mt-5 border-t border-[#edf0f7] pt-5">
                <div className="flex items-center justify-between gap-3"><legend className="text-sm font-extrabold">Pieces demandees</legend><button type="button" onClick={() => setRequiredDocuments((items) => [...items, { kind: "OTHER", label: "", required: true }])} className="text-xs font-extrabold text-[#2457f5]">Ajouter une piece</button></div>
                <div className="mt-3 grid gap-2">
                  {requiredDocuments.length === 0 ? <p className="text-xs text-[#667189]">Aucune piece specifique detectee. Ajoutez les justificatifs indiques par le reglement.</p> : null}
                  {requiredDocuments.map((document, index) => <div key={`${document.kind}-${index}`} className="grid grid-cols-[120px_1fr_auto_auto] items-center gap-2">
                    <select value={document.kind} onChange={(event) => updateRequiredDocument(index, { kind: event.target.value })} className="field py-2 text-xs"><option value="ORANGE_INVOICE">Facture</option><option value="IDENTITY_DOCUMENT">Identite</option><option value="BANK_DETAILS">RIB</option><option value="PURCHASE_PROOF">Achat</option><option value="OTHER">Autre</option></select>
                    <input value={document.label} onChange={(event) => updateRequiredDocument(index, { label: event.target.value })} className="field py-2 text-xs" placeholder="Libelle de la piece" />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={document.required} onChange={(event) => updateRequiredDocument(index, { required: event.target.checked })} />Requise</label>
                    <button type="button" onClick={() => setRequiredDocuments((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="text-xs font-bold text-[#b54733]" aria-label="Supprimer la piece">Suppr.</button>
                  </div>)}
                </div>
              </fieldset>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                Conditions du jeu et du remboursement
                <textarea value={conditionsText} onChange={(event) => setConditionsText(event.target.value)} rows={5} className="field font-normal" placeholder="Éligibilité: ...&#10;Remboursement: ..." />
              </label>
              <fieldset className="mt-5 grid gap-4 border-t border-[#edf0f7] pt-5">
                <legend className="text-sm font-extrabold">Instructions de remboursement</legend>
                <label className="grid gap-2 text-sm font-semibold">Mecanique de participation<input value={participationMechanism} onChange={(event) => setParticipationMechanism(event.target.value)} className="field font-normal" placeholder="Ex. SMS+ au 12345" /></label>
                <label className="grid gap-2 text-sm font-semibold">Periode de participation<input value={participationPeriod} onChange={(event) => setParticipationPeriod(event.target.value)} className="field font-normal" placeholder="Ex. du 1er au 30 juin 2026" /></label>
                <label className="grid gap-2 text-sm font-semibold">Date limite de remboursement<input value={reimbursementDeadline} onChange={(event) => setReimbursementDeadline(event.target.value)} className="field font-normal" placeholder="Date ISO ou formulation exacte" /></label>
                <label className="grid gap-2 text-sm font-semibold">Destinataire de la demande<input value={reimbursementRecipient} onChange={(event) => setReimbursementRecipient(event.target.value)} className="field font-normal" /></label>
                <label className="grid gap-2 text-sm font-semibold">Adresse postale<textarea value={reimbursementAddress} onChange={(event) => setReimbursementAddress(event.target.value)} rows={2} className="field font-normal" /></label>
                <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold">E-mail<input value={reimbursementEmail} onChange={(event) => setReimbursementEmail(event.target.value)} type="email" className="field font-normal" /></label><label className="grid gap-2 text-sm font-semibold">Mode de remboursement<input value={reimbursementMethod} onChange={(event) => setReimbursementMethod(event.target.value)} className="field font-normal" placeholder="Virement, cheque..." /></label></div>
                <label className="grid gap-2 text-sm font-semibold">Conditions d'eligibilite<textarea value={eligibilityConditionsText} onChange={(event) => setEligibilityConditionsText(event.target.value)} rows={3} className="field font-normal" placeholder="Une condition par ligne" /></label>
                <label className="grid gap-2 text-sm font-semibold">Conditions de remboursement<textarea value={reimbursementConditionsText} onChange={(event) => setReimbursementConditionsText(event.target.value)} rows={3} className="field font-normal" placeholder="Une condition par ligne" /></label>
                <label className="grid gap-2 text-sm font-semibold">Frais exclus<textarea value={excludedCostsText} onChange={(event) => setExcludedCostsText(event.target.value)} rows={2} className="field font-normal" placeholder="Une exclusion par ligne" /></label>
                <label className="grid gap-2 text-sm font-semibold">Mentions a inclure dans le courrier<textarea value={letterMentionsText} onChange={(event) => setLetterMentionsText(event.target.value)} rows={3} className="field font-normal" placeholder="Une mention par ligne" /></label>
              </fieldset>
              {sourceDocumentId ? <div className="mt-5"><Button disabled={isBusy}>{editingRuleId ? "Enregistrer les modifications" : "Creer pour relecture"}</Button></div> : null}
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
                    {readString(rule.constraints.reimbursementDeadline) ? <p className="mt-2 text-sm text-[#52607a]">Echeance: {readString(rule.constraints.reimbursementDeadline)}</p> : null}
                    {readString(rule.constraints.reimbursementRecipient) || readString(rule.constraints.reimbursementAddress) ? <p className="mt-2 whitespace-pre-line text-sm text-[#52607a]">Envoi: {[readString(rule.constraints.reimbursementRecipient), readString(rule.constraints.reimbursementAddress)].filter(Boolean).join("\n")}</p> : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button type="button" variant="secondary" disabled={isBusy} onClick={() => editRule(rule)}>Modifier</Button>
                      {rule.status === "NEEDS_REVIEW" ? (
                        <Button type="button" disabled={isBusy} onClick={() => approveRule(rule.id)}>Approuver</Button>
                      ) : null}
                      <Button type="button" variant="secondary" disabled={isBusy} onClick={() => deleteRule(rule)} className="border-[#f0b8aa] text-[#b54733] hover:bg-[#fff0ec]">Supprimer</Button>
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

function candidateToRulePayload(candidate: RuleCandidate) {
  return {
    sourceDocumentId: candidate.sourceDocumentId,
    organizerName: candidate.organizerName,
    name: candidate.name,
    reimbursementCents: candidate.reimbursementCents,
    requiredDocuments: candidate.requiredDocuments,
    constraints: candidate.constraints,
    ...(candidate.validFrom ? { validFrom: candidate.validFrom } : {}),
    ...(candidate.validUntil ? { validUntil: candidate.validUntil } : {}),
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

function readRequiredDocuments(value: unknown): RequiredDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((document) => {
    if (!document || typeof document !== "object") return [];
    const parsed = document as Record<string, unknown>;
    return typeof parsed.kind === "string" && typeof parsed.label === "string" && typeof parsed.required === "boolean"
      ? [{ kind: parsed.kind, label: parsed.label, required: parsed.required }]
      : [];
  });
}

function formatLines(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : "";
}

function parseLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
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
