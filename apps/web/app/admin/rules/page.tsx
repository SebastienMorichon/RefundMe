"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@lydoc/ui";
import { AppShell } from "../../../components/app-shell";
import { apiFetch as fetch } from "../../../lib/api-client";

type Rule = {
  id: string;
  version: number;
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

type PostalExpenseForm = {
  available: boolean;
  appliesTo: "REFUND_REQUEST" | "RULE_COPY_REQUEST" | "BOTH" | "UNSPECIFIED";
  postageReimbursable: boolean;
  postageEuros: string;
  postageBasis: string;
  printingReimbursable: boolean;
  printingEurosPerPage: string;
  printingMaxPages: string;
  printingBasis: string;
  claimLimitScope: "PER_REQUEST" | "PER_PARTICIPANT_PER_MONTH" | "PER_PARTICIPANT_PER_GAME" | "PER_HOUSEHOLD_PER_GAME" | "OTHER" | "UNSPECIFIED";
  claimLimitStrict: boolean;
  claimLimitDetails: string;
  requestInstructions: string;
  requiredProofsText: string;
  sourceReference: string;
};

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
  const [postalExpense, setPostalExpense] = useState<PostalExpenseForm>(emptyPostalExpenseForm());
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
      const form = new FormData();
      form.set("kind", "GAME_RULE_PDF");
      form.set("file", sourceFile, sourceFile.name);
      const uploadResponse = await fetch(`${apiUrl}/documents`, {
        method: "POST",
        credentials: "include",
        body: form,
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
      const editingRule = editingRuleId
        ? rules.find((rule) => rule.id === editingRuleId)
        : undefined;
      if (editingRuleId && !editingRule) {
        throw new Error(
          "Cette version du reglement n'est plus disponible. Rechargez la liste.",
        );
      }

      const reimbursement = Number(reimbursementEuros);
      if (!organizerName.trim() || !ruleName.trim() || !Number.isFinite(reimbursement) || reimbursement < 0) {
        throw new Error("Verifiez l'organisateur, le nom et le montant avant de creer le reglement.");
      }
      if (requiredDocuments.some((document) => !document.label.trim())) {
        throw new Error("Chaque piece demandee doit avoir un libelle.");
      }
      if (
        postalExpense.available &&
        !postalExpense.postageReimbursable &&
        !postalExpense.printingReimbursable
      ) {
        throw new Error("Indiquez si l'affranchissement ou l'impression est remboursable.");
      }

      setMessage("Creation de la regle en relecture...");
      const ruleResponse = await fetch(
        editingRuleId ? `${apiUrl}/admin/rules/${editingRuleId}` : `${apiUrl}/admin/rules`,
        {
        method: editingRuleId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(editingRule ? { expectedVersion: editingRule.version } : {}),
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
            postalExpenseReimbursement: postalExpensePayload(postalExpense),
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

  async function approveRule(rule: Rule) {
    setIsBusy(true);
    setMessage("Validation du reglement...");

    try {
      const response = await fetch(`${apiUrl}/admin/rules/${rule.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expectedVersion: rule.version }),
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

  async function reanalyzeRule(rule: Rule) {
    setIsBusy(true);
    setMessage("Nouvelle lecture du règlement par Mistral...");
    try {
      const response = await fetch(
        `${apiUrl}/admin/rules/extract/${rule.sourceDocument.id}`,
        { method: "POST", credentials: "include" },
      );
      const payload = await readJson(response);
      const candidate = readRuleCandidate(payload.candidate);
      if (!response.ok || !candidate) {
        throw new Error(
          errorMessage(payload, "Impossible de relire le règlement."),
        );
      }
      hydrateCandidate(candidate);
      setEditingRuleId(rule.id);
      setMessage(
        "Nouvelle analyse chargée. Vérifiez notamment les frais d'envoi et d'impression, puis enregistrez.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Impossible de relire le règlement.",
      );
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
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expectedVersion: rule.version }),
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
    setPostalExpense(readPostalExpenseForm(value.postalExpenseReimbursement));
  }

  function resetConstraintFields() {
    hydrateConstraintFields({});
  }

  const canManageRules = user?.role === "ADMIN";

  return (
    <AppShell active="admin" email={user?.email} isAdmin>
      <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <p className="text-xs font-extrabold uppercase text-[#7b8781]">Administration</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">Règlements des jeux</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736d]">
          Chaque règlement est analysé, relu puis approuvé avant d’être utilisé pour un dossier client.
        </p>
        <div className="mt-5 border-l-4 border-[#087a55] bg-[#e9f5ef] p-4 text-sm text-[#2f6b53]">
          {message}
        </div>

        {canManageRules ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <form onSubmit={createRule} className="surface p-5 sm:p-6">
              <h2 className="text-lg font-extrabold text-[#17211d]">Nouveau règlement</h2>
              <label className="mt-4 grid gap-2 text-sm font-semibold">
                PDF source
                <input name="source" type="file" accept="application/pdf" disabled={editingRuleId !== null || isBusy} onChange={(event) => void analyzeAndCreateRule(event.target.files?.[0] ?? null)} className="field font-normal file:mr-3 file:rounded-md file:border-0 file:bg-[#e4f3eb] file:px-3 file:py-1 file:text-xs file:font-extrabold file:text-[#087a55]" />
                <span className="text-xs font-normal text-[#66736d]">L'analyse OCR et la creation de la fiche demarrent automatiquement.</span>
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
                <div className="flex items-center justify-between gap-3"><legend className="text-sm font-extrabold">Pieces demandees</legend><button type="button" onClick={() => setRequiredDocuments((items) => [...items, { kind: "OTHER", label: "", required: true }])} className="text-xs font-extrabold text-[#087a55]">Ajouter une piece</button></div>
                <div className="mt-3 grid gap-2">
                  {requiredDocuments.length === 0 ? <p className="text-xs text-[#66736d]">Aucune piece specifique detectee. Ajoutez les justificatifs indiques par le reglement.</p> : null}
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
                <fieldset className="grid gap-4 border-y border-[#e3e9e6] py-5">
                  <legend className="px-2 text-sm font-extrabold">Frais d'envoi et d'impression remboursables</legend>
                  <label className="flex items-start gap-3 text-sm leading-6">
                    <input
                      type="checkbox"
                      checked={postalExpense.available}
                      onChange={(event) => setPostalExpense((current) => ({ ...current, available: event.target.checked }))}
                      className="mt-1 h-4 w-4 accent-[#087a55]"
                    />
                    <span><strong>Le règlement propose ce remboursement.</strong><br /><span className="text-xs text-[#66736d]">Cette option sera présentée au client uniquement si elle concerne sa demande de remboursement.</span></span>
                  </label>
                  {postalExpense.available ? (
                    <>
                      <label className="grid gap-2 text-sm font-semibold">
                        Demande concernée
                        <select value={postalExpense.appliesTo} onChange={(event) => setPostalExpense((current) => ({ ...current, appliesTo: event.target.value as PostalExpenseForm["appliesTo"] }))} className="field font-normal">
                          <option value="REFUND_REQUEST">Demande de remboursement</option>
                          <option value="RULE_COPY_REQUEST">Demande de copie du règlement uniquement</option>
                          <option value="BOTH">Les deux demandes</option>
                          <option value="UNSPECIFIED">À confirmer</option>
                        </select>
                      </label>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="border-l-2 border-[#b9d8c9] pl-4">
                          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={postalExpense.postageReimbursable} onChange={(event) => setPostalExpense((current) => ({ ...current, postageReimbursable: event.target.checked }))} className="h-4 w-4 accent-[#087a55]" />Affranchissement remboursable</label>
                          <label className="mt-3 grid gap-2 text-xs font-semibold">Montant fixe (EUR)<input value={postalExpense.postageEuros} onChange={(event) => setPostalExpense((current) => ({ ...current, postageEuros: event.target.value }))} type="number" min="0" step="0.01" className="field font-normal" placeholder="Vide si tarif en vigueur" /></label>
                          <label className="mt-3 grid gap-2 text-xs font-semibold">Barème exact<input value={postalExpense.postageBasis} onChange={(event) => setPostalExpense((current) => ({ ...current, postageBasis: event.target.value }))} className="field font-normal" placeholder="Ex. tarif lettre verte moins de 20 g" /></label>
                        </div>
                        <div className="border-l-2 border-[#b9d8c9] pl-4">
                          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={postalExpense.printingReimbursable} onChange={(event) => setPostalExpense((current) => ({ ...current, printingReimbursable: event.target.checked }))} className="h-4 w-4 accent-[#087a55]" />Impression ou photocopies remboursables</label>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-xs font-semibold">Prix par page (EUR)<input value={postalExpense.printingEurosPerPage} onChange={(event) => setPostalExpense((current) => ({ ...current, printingEurosPerPage: event.target.value }))} type="number" min="0" step="0.01" className="field font-normal" /></label><label className="grid gap-2 text-xs font-semibold">Plafond de pages<input value={postalExpense.printingMaxPages} onChange={(event) => setPostalExpense((current) => ({ ...current, printingMaxPages: event.target.value }))} type="number" min="1" step="1" className="field font-normal" /></label></div>
                          <label className="mt-3 grid gap-2 text-xs font-semibold">Barème exact<input value={postalExpense.printingBasis} onChange={(event) => setPostalExpense((current) => ({ ...current, printingBasis: event.target.value }))} className="field font-normal" placeholder="Ex. 0,15 EUR par photocopie" /></label>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-2 text-sm font-semibold">Fréquence autorisée<select value={postalExpense.claimLimitScope} onChange={(event) => setPostalExpense((current) => ({ ...current, claimLimitScope: event.target.value as PostalExpenseForm["claimLimitScope"] }))} className="field font-normal"><option value="UNSPECIFIED">Non précisée</option><option value="PER_REQUEST">Pour chaque demande</option><option value="PER_PARTICIPANT_PER_MONTH">Une par participant et par mois</option><option value="PER_PARTICIPANT_PER_GAME">Une par participant et par jeu</option><option value="PER_HOUSEHOLD_PER_GAME">Une par foyer et par jeu</option><option value="OTHER">Autre limite</option></select></label>
                        <label className="grid gap-2 text-sm font-semibold">Formulation du règlement<input value={postalExpense.claimLimitDetails} onChange={(event) => setPostalExpense((current) => ({ ...current, claimLimitDetails: event.target.value }))} className="field font-normal" placeholder="Recopiez la limite exacte" /></label>
                      </div>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={postalExpense.claimLimitStrict} onChange={(event) => setPostalExpense((current) => ({ ...current, claimLimitStrict: event.target.checked }))} className="h-4 w-4 accent-[#087a55]" />Cette fréquence est une limite stricte, et non une simple recommandation.</label>
                      <label className="grid gap-2 text-sm font-semibold">Comment formuler la demande<textarea value={postalExpense.requestInstructions} onChange={(event) => setPostalExpense((current) => ({ ...current, requestInstructions: event.target.value }))} rows={2} className="field font-normal" /></label>
                      <label className="grid gap-2 text-sm font-semibold">Justificatifs spécifiques<textarea value={postalExpense.requiredProofsText} onChange={(event) => setPostalExpense((current) => ({ ...current, requiredProofsText: event.target.value }))} rows={2} className="field font-normal" placeholder="Un justificatif par ligne" /></label>
                      <label className="grid gap-2 text-sm font-semibold">Article ou section source<input value={postalExpense.sourceReference} onChange={(event) => setPostalExpense((current) => ({ ...current, sourceReference: event.target.value }))} className="field font-normal" /></label>
                    </>
                  ) : null}
                </fieldset>
                <label className="grid gap-2 text-sm font-semibold">Frais exclus<textarea value={excludedCostsText} onChange={(event) => setExcludedCostsText(event.target.value)} rows={2} className="field font-normal" placeholder="Une exclusion par ligne" /></label>
                <label className="grid gap-2 text-sm font-semibold">Mentions a inclure dans le courrier<textarea value={letterMentionsText} onChange={(event) => setLetterMentionsText(event.target.value)} rows={3} className="field font-normal" placeholder="Une mention par ligne" /></label>
              </fieldset>
              {sourceDocumentId ? <div className="mt-5"><Button disabled={isBusy}>{editingRuleId ? "Enregistrer les modifications" : "Creer pour relecture"}</Button></div> : null}
            </form>

            <section className="surface p-5 sm:p-6">
              <h2 className="text-lg font-extrabold text-[#17211d]">File de relecture</h2>
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
                    {formatPostalExpenseSummary(rule.constraints) ? <p className="mt-2 text-sm text-[#2f6b53]">Frais annexes: {formatPostalExpenseSummary(rule.constraints)}</p> : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button type="button" variant="secondary" disabled={isBusy} onClick={() => reanalyzeRule(rule)}>Relire avec l'IA</Button>
                      <Button type="button" variant="secondary" disabled={isBusy} onClick={() => editRule(rule)}>Modifier</Button>
                      {rule.status === "NEEDS_REVIEW" ? (
                        <Button type="button" disabled={isBusy} onClick={() => approveRule(rule)}>Approuver</Button>
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
    typeof rule.version !== "number" ||
    !Number.isInteger(rule.version) ||
    rule.version < 1 ||
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
    version: rule.version,
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

function emptyPostalExpenseForm(): PostalExpenseForm {
  return {
    available: false,
    appliesTo: "UNSPECIFIED",
    postageReimbursable: false,
    postageEuros: "",
    postageBasis: "",
    printingReimbursable: false,
    printingEurosPerPage: "",
    printingMaxPages: "",
    printingBasis: "",
    claimLimitScope: "UNSPECIFIED",
    claimLimitStrict: false,
    claimLimitDetails: "",
    requestInstructions: "",
    requiredProofsText: "",
    sourceReference: "",
  };
}

function readPostalExpenseForm(value: unknown): PostalExpenseForm {
  const input = readRecord(value);
  const postage = readRecord(input.postage);
  const printing = readRecord(input.printing);
  const claimLimit = readRecord(input.claimLimit);
  const appliesTo = ["REFUND_REQUEST", "RULE_COPY_REQUEST", "BOTH", "UNSPECIFIED"].includes(String(input.appliesTo))
    ? input.appliesTo as PostalExpenseForm["appliesTo"]
    : "UNSPECIFIED";
  const claimLimitScope = ["PER_REQUEST", "PER_PARTICIPANT_PER_MONTH", "PER_PARTICIPANT_PER_GAME", "PER_HOUSEHOLD_PER_GAME", "OTHER", "UNSPECIFIED"].includes(String(claimLimit.scope))
    ? claimLimit.scope as PostalExpenseForm["claimLimitScope"]
    : "UNSPECIFIED";
  const postageCents = readOptionalInteger(postage.amountCents);
  const printingCents = readOptionalInteger(printing.centsPerPage);
  const maxPages = readOptionalInteger(printing.maxPages);

  return {
    available: input.available === true,
    appliesTo,
    postageReimbursable: postage.reimbursable === true,
    postageEuros: postageCents === null ? "" : (postageCents / 100).toFixed(2),
    postageBasis: readString(postage.basis) ?? "",
    printingReimbursable: printing.reimbursable === true,
    printingEurosPerPage: printingCents === null ? "" : (printingCents / 100).toFixed(2),
    printingMaxPages: maxPages === null ? "" : String(maxPages),
    printingBasis: readString(printing.basis) ?? "",
    claimLimitScope,
    claimLimitStrict: claimLimit.strict === true,
    claimLimitDetails: readString(claimLimit.details) ?? "",
    requestInstructions: readString(input.requestInstructions) ?? "",
    requiredProofsText: formatLines(input.requiredProofs),
    sourceReference: readString(input.sourceReference) ?? "",
  };
}

function postalExpensePayload(value: PostalExpenseForm) {
  return {
    available: value.available,
    appliesTo: value.appliesTo,
    postage: {
      reimbursable: value.postageReimbursable,
      amountCents: optionalEurosToCents(value.postageEuros, "Le montant d'affranchissement"),
      basis: value.postageBasis.trim(),
    },
    printing: {
      reimbursable: value.printingReimbursable,
      centsPerPage: optionalEurosToCents(value.printingEurosPerPage, "Le prix d'impression par page"),
      maxPages: optionalPositiveInteger(value.printingMaxPages, "Le plafond de pages"),
      basis: value.printingBasis.trim(),
    },
    claimLimit: {
      scope: value.claimLimitScope,
      strict: value.claimLimitStrict,
      details: value.claimLimitDetails.trim(),
    },
    requestInstructions: value.requestInstructions.trim(),
    requiredProofs: parseLines(value.requiredProofsText),
    sourceReference: value.sourceReference.trim(),
  };
}

function formatPostalExpenseSummary(constraints: Record<string, unknown>): string {
  const value = readPostalExpenseForm(constraints.postalExpenseReimbursement);
  if (!value.available) return "";
  if (value.appliesTo === "RULE_COPY_REQUEST") return "uniquement pour demander une copie du règlement";
  const parts = [
    value.postageReimbursable ? value.postageBasis || "affranchissement" : "",
    value.printingReimbursable ? value.printingBasis || "impression" : "",
    value.claimLimitDetails,
  ].filter(Boolean);
  return parts.join(" · ");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readOptionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function optionalEurosToCents(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} est invalide.`);
  return Math.round(amount * 100);
}

function optionalPositiveInteger(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 1) throw new Error(`${label} est invalide.`);
  return amount;
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
