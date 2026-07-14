"use client";

import { ArrowLeft, Check, CheckCircle2, ChevronRight, CircleDollarSign, FileCheck2, FileText, LoaderCircle, LockKeyhole, ReceiptText, ShieldCheck, UploadCloud } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../../components/app-shell";

type RequiredDocument = { kind: string; label: string; required: boolean; supplied: boolean };
type CaseDetail = { id: string; status: string; estimatedRecoverableCents: number; serviceFeeCents: number; rule: { id: string; name: string; organizer: string }; requiredDocuments: RequiredDocument[]; missingDocuments: RequiredDocument[] };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maxDocumentSizeBytes = 20 * 1024 * 1024;

export default function CasePage() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const [administrativeCase, setAdministrativeCase] = useState<CaseDetail | null>(null);
  const [message, setMessage] = useState("Chargement du dossier…");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => { if (caseId) void loadCase(); }, [caseId]);

  async function loadCase() {
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}`, { credentials: "include" });
      const payload = await readJson(response);
      const parsedCase = readCase(payload.case);
      if (!response.ok || !parsedCase) throw new Error(errorMessage(payload, "Dossier introuvable."));
      setAdministrativeCase(parsedCase);
      setMessage(parsedCase.status === "READY_TO_PAY" ? "Votre dossier est complet et prêt pour la prochaine étape." : parsedCase.status === "DRAFT" ? "Le règlement a été identifié. Lancez la préparation pour voir les pièces utiles." : "Ajoutez uniquement les pièces encore demandées.");
      setMessageTone(parsedCase.status === "READY_TO_PAY" ? "success" : "info");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Dossier introuvable."); setMessageTone("error"); }
  }

  async function startCase() { await sendCaseAction("start", "Préparation de la liste des pièces…"); }

  async function attachDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const kind = String(formData.get("kind") ?? "");
    const file = formData.get("document") as File | null;
    if (!file || !kind) { setMessage("Choisissez la pièce demandée et le fichier correspondant."); setMessageTone("error"); return; }
    if (file.size > maxDocumentSizeBytes || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) { setMessage("Utilisez un PDF, JPG ou PNG de 20 Mo maximum."); setMessageTone("error"); return; }
    setIsBusy(true);
    setMessage("Dépôt sécurisé de la pièce…");
    setMessageTone("info");
    try {
      const uploadResponse = await fetch(`${apiUrl}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ kind, originalName: file.name, mimeType: file.type, contentBase64: await fileToBase64(file) }) });
      const uploadPayload = await readJson(uploadResponse);
      const documentId = readDocumentId(uploadPayload.document);
      if (!uploadResponse.ok || !documentId) throw new Error(errorMessage(uploadPayload, "Impossible de déposer la pièce."));
      const attachResponse = await fetch(`${apiUrl}/cases/${caseId}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ documentId }) });
      const attachPayload = await readJson(attachResponse);
      const parsedCase = readCase(attachPayload.case);
      if (!attachResponse.ok || !parsedCase) throw new Error(errorMessage(attachPayload, "Impossible de rattacher la pièce au dossier."));
      setAdministrativeCase(parsedCase);
      form.reset();
      setMessage(parsedCase.status === "READY_TO_PAY" ? "Toutes les pièces sont réunies. Votre dossier est complet." : "La pièce a bien été ajoutée. Il en reste encore à fournir.");
      setMessageTone("success");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Le dépôt n’a pas abouti."); setMessageTone("error"); } finally { setIsBusy(false); }
  }

  async function sendCaseAction(action: string, progressMessage: string) {
    setIsBusy(true); setMessage(progressMessage); setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/${action}`, { method: "POST", credentials: "include" });
      const payload = await readJson(response);
      const parsedCase = readCase(payload.case);
      if (!response.ok || !parsedCase) throw new Error(errorMessage(payload, "Action impossible."));
      setAdministrativeCase(parsedCase); setMessage("La préparation a commencé. Ajoutez les pièces indiquées ci-dessous."); setMessageTone("success");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action impossible."); setMessageTone("error"); } finally { setIsBusy(false); }
  }

  const missingDocuments = administrativeCase?.missingDocuments ?? [];
  const progress = progressIndex(administrativeCase?.status ?? "DRAFT");

  return (
    <AppShell active="cases">
      <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <a href="/dashboard#dossiers" className="inline-flex items-center gap-2 text-sm font-bold text-[#667189] hover:text-[#2457f5]"><ArrowLeft size={16} /> Retour aux dossiers</a>
        <div className="mt-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="text-xs font-extrabold uppercase text-[#7a8499]">Dossier de remboursement</p><h1 className="mt-2 text-2xl font-extrabold text-[#102544] sm:text-3xl">{administrativeCase?.rule.name ?? "Chargement…"}</h1><p className="mt-2 text-sm text-[#667189]">{administrativeCase?.rule.organizer ?? ""}</p></div>
          {administrativeCase ? <StatusBadge status={administrativeCase.status} /> : null}
        </div>

        <div className={`mt-6 flex items-start gap-3 border-l-4 p-4 text-sm leading-6 ${messageTone === "success" ? "border-[#16875b] bg-[#e8f7f0] text-[#326950]" : messageTone === "error" ? "border-[#e9654b] bg-[#fff0ec] text-[#8e3d2c]" : "border-[#2457f5] bg-[#eef3ff] text-[#344f8d]"}`} role="status">
          {messageTone === "success" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : messageTone === "error" ? <ShieldCheck size={18} className="mt-0.5 shrink-0" /> : isBusy ? <LoaderCircle size={18} className="mt-0.5 shrink-0 animate-spin" /> : <ReceiptText size={18} className="mt-0.5 shrink-0" />}{message}
        </div>

        {administrativeCase ? (
          <>
            <section className="surface mt-6 overflow-hidden">
              <div className="grid divide-y divide-[#dce3ed] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="p-5 sm:p-6"><p className="text-xs font-bold text-[#7a8499]">Montant estimé</p><p className="mt-2 text-2xl font-extrabold text-[#102544]">{formatCents(administrativeCase.estimatedRecoverableCents)}</p></div>
                <div className="p-5 sm:p-6"><p className="text-xs font-bold text-[#7a8499]">Frais de service</p><p className="mt-2 text-2xl font-extrabold text-[#102544]">{formatCents(administrativeCase.serviceFeeCents)}</p></div>
                <div className="p-5 sm:p-6"><p className="text-xs font-bold text-[#7a8499]">Gain potentiel net</p><p className="mt-2 text-2xl font-extrabold text-[#16875b]">{formatCents(Math.max(0, administrativeCase.estimatedRecoverableCents - administrativeCase.serviceFeeCents))}</p></div>
              </div>
              <div className="border-t border-[#dce3ed] bg-[#f8fafc] px-5 py-5 sm:px-6">
                <ol className="grid gap-4 sm:grid-cols-4">
                  {["Règlement identifié", "Pièces réunies", "Validation", "Envoi"].map((label, index) => <li key={label} className="flex items-center gap-3"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-extrabold ${index < progress ? "bg-[#16875b] text-white" : index === progress ? "bg-[#2457f5] text-white" : "bg-[#e1e7ef] text-[#7a8499]"}`}>{index < progress ? <Check size={14} strokeWidth={3} /> : index + 1}</span><span className={`text-xs font-bold ${index <= progress ? "text-[#34415d]" : "text-[#8b95a8]"}`}>{label}</span></li>)}
                </ol>
              </div>
            </section>

            <section className="mt-6 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="surface p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-extrabold text-[#102544]">Pièces du dossier</h2><p className="mt-1 text-sm text-[#667189]">Demandées uniquement par le règlement applicable.</p></div><span className="text-xs font-extrabold text-[#7a8499]">{administrativeCase.requiredDocuments.length - missingDocuments.length}/{administrativeCase.requiredDocuments.length}</span></div>
                {administrativeCase.requiredDocuments.length ? <div className="mt-5 divide-y divide-[#e2e8f0] border-y border-[#e2e8f0]">{administrativeCase.requiredDocuments.map((document) => <div key={document.kind} className="flex items-center gap-4 py-4"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${document.supplied ? "bg-[#e8f7f0] text-[#16875b]" : "bg-[#fff4e7] text-[#a95d12]"}`}>{document.supplied ? <FileCheck2 size={19} /> : <FileText size={19} />}</span><div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-[#34415d]">{document.label}</p><p className="mt-1 text-xs text-[#7a8499]">{document.supplied ? "Ajoutée au dossier" : "Encore nécessaire"}</p></div><span className={`text-xs font-extrabold ${document.supplied ? "text-[#16875b]" : "text-[#a95d12]"}`}>{document.supplied ? "Fourni" : "Manquant"}</span></div>)}</div> : <p className="mt-6 text-sm text-[#667189]">Lancez la préparation pour obtenir la liste exacte.</p>}
              </div>

              <div>
                {administrativeCase.status === "DRAFT" ? (
                  <section className="surface p-5 sm:p-6"><span className="grid h-11 w-11 place-items-center rounded-md bg-[#e8efff] text-[#2457f5]"><ReceiptText size={21} /></span><h2 className="mt-5 text-lg font-extrabold text-[#102544]">Prêt à préparer ce dossier ?</h2><p className="mt-3 text-sm leading-6 text-[#667189]">Lydoc va lire les exigences du règlement et afficher uniquement les justificatifs nécessaires.</p><button disabled={isBusy} onClick={startCase} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:opacity-50">Préparer mon dossier <ChevronRight size={17} /></button></section>
                ) : null}
                {administrativeCase.status !== "DRAFT" && missingDocuments.length > 0 ? (
                  <form onSubmit={attachDocument} className="surface p-5 sm:p-6"><span className="grid h-11 w-11 place-items-center rounded-md bg-[#e8efff] text-[#2457f5]"><UploadCloud size={21} /></span><h2 className="mt-5 text-lg font-extrabold text-[#102544]">Ajouter une pièce</h2><p className="mt-2 text-sm leading-6 text-[#667189]">Choisissez le type demandé puis le fichier correspondant.</p><label className="mt-5 grid gap-2 text-sm font-bold text-[#26334f]">Pièce demandée<select name="kind" className="field">{missingDocuments.map((document) => <option key={document.kind} value={document.kind}>{document.label}</option>)}</select></label><label className="mt-4 grid gap-2 text-sm font-bold text-[#26334f]">Fichier<input name="document" type="file" accept="application/pdf,image/png,image/jpeg" className="field file:mr-3 file:rounded-md file:border-0 file:bg-[#e8efff] file:px-3 file:py-1 file:text-xs file:font-extrabold file:text-[#2457f5]" /></label><p className="mt-3 flex items-center gap-2 text-xs text-[#667189]"><LockKeyhole size={14} className="text-[#16875b]" />PDF, JPG ou PNG · 20 Mo maximum</p><button disabled={isBusy} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:opacity-50">{isBusy ? <LoaderCircle size={17} className="animate-spin" /> : <UploadCloud size={17} />} Ajouter au dossier</button></form>
                ) : null}
                {administrativeCase.status === "READY_TO_PAY" ? (
                  <section className="surface border-t-4 border-t-[#16875b] p-5 sm:p-6"><span className="grid h-11 w-11 place-items-center rounded-md bg-[#e8f7f0] text-[#16875b]"><CheckCircle2 size={22} /></span><h2 className="mt-5 text-lg font-extrabold text-[#102544]">Votre dossier est complet.</h2><p className="mt-3 text-sm leading-6 text-[#667189]">Toutes les pièces obligatoires sont réunies. Le paiement et la génération finale seront activés à la prochaine étape du produit.</p><div className="mt-5 flex items-center justify-between border-y border-[#e2e8f0] py-4"><span className="text-sm font-bold text-[#536078]">Frais de préparation</span><span className="text-lg font-extrabold text-[#102544]">{formatCents(administrativeCase.serviceFeeCents)}</span></div><button type="button" disabled className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white opacity-50"><CircleDollarSign size={17} /> Paiement bientôt disponible</button></section>
                ) : null}
              </div>
            </section>

            <div className="mt-6 flex items-start gap-3 border-t border-[#dce3ed] pt-5 text-xs leading-5 text-[#667189]"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#16875b]" /><p>Lydoc prépare votre dossier conformément aux informations du règlement. L’acceptation et le délai de remboursement restent sous la responsabilité de l’organisateur.</p></div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) { const success = ["READY_TO_PAY", "SENT", "REFUNDED"].includes(status); return <span className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-extrabold ${success ? "bg-[#e8f7f0] text-[#16875b]" : "bg-[#fff4e7] text-[#a95d12]"}`}><span className={`status-dot ${success ? "bg-[#16875b]" : "bg-[#d47a22]"}`} />{formatStatus(status)}</span>; }
async function fileToBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result.slice(reader.result.indexOf(",") + 1)) : reject(new Error("Lecture impossible.")); reader.onerror = () => reject(new Error("Lecture impossible.")); reader.readAsDataURL(file); }); }
async function readJson(response: Response): Promise<Record<string, unknown>> { try { const value: unknown = await response.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return {}; } }
function errorMessage(payload: Record<string, unknown>, fallback: string): string { return typeof payload.message === "string" ? payload.message : fallback; }
function readDocumentId(value: unknown): string | null { return value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string" ? (value as Record<string, unknown>).id as string : null; }
function readCase(value: unknown): CaseDetail | null { if (!value || typeof value !== "object") return null; const item = value as Record<string, unknown>; const rule = item.rule as Record<string, unknown> | undefined; if (typeof item.id !== "string" || typeof item.status !== "string" || typeof item.estimatedRecoverableCents !== "number" || typeof item.serviceFeeCents !== "number" || !rule || typeof rule.id !== "string" || typeof rule.name !== "string" || typeof rule.organizer !== "string" || !Array.isArray(item.requiredDocuments) || !Array.isArray(item.missingDocuments)) return null; const parseDocument = (raw: unknown): RequiredDocument | null => { if (!raw || typeof raw !== "object") return null; const document = raw as Record<string, unknown>; return typeof document.kind === "string" && typeof document.label === "string" && typeof document.required === "boolean" && typeof document.supplied === "boolean" ? { kind: document.kind, label: document.label, required: document.required, supplied: document.supplied } : null; }; return { id: item.id, status: item.status, estimatedRecoverableCents: item.estimatedRecoverableCents, serviceFeeCents: item.serviceFeeCents, rule: { id: rule.id, name: rule.name, organizer: rule.organizer }, requiredDocuments: item.requiredDocuments.flatMap((raw) => { const parsed = parseDocument(raw); return parsed ? [parsed] : []; }), missingDocuments: item.missingDocuments.flatMap((raw) => { const parsed = parseDocument(raw); return parsed ? [parsed] : []; }) }; }
function formatCents(cents: number): string { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100); }
function formatStatus(status: string): string { const labels: Record<string, string> = { DRAFT: "À préparer", WAITING_FOR_USER_DOCUMENTS: "Pièces attendues", READY_TO_PAY: "Dossier complet", PAID: "Payé", SENT: "Envoyé", REFUNDED: "Remboursé", REJECTED: "Refusé" }; return labels[status] ?? status; }
function progressIndex(status: string): number { if (["REFUNDED", "SENT", "PAID"].includes(status)) return 3; if (status === "READY_TO_PAY") return 2; if (status === "WAITING_FOR_USER_DOCUMENTS") return 1; return 0; }
