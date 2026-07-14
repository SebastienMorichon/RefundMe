"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  FileSearch,
  FileText,
  FolderKanban,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ReceiptText,
  RefreshCw,
  Sparkles,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";

type User = { id: string; email: string; role: string };
type UploadedDocument = { id: string; kind: string; status: string; originalName: string; mimeType: string; sizeBytes: number; encrypted: boolean };
type AdministrativeCase = { id: string; status: string; estimatedRecoverableCents: number; serviceFeeCents: number; confidence: number | null; rule: { id: string; name: string; organizer: string } | null };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maxDocumentSizeBytes = 20 * 1024 * 1024;
const allowedTypes = ["application/pdf", "image/png", "image/jpeg"];

export default function DashboardPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [cases, setCases] = useState<AdministrativeCase[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState("Chargement de votre espace…");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [isBusy, setIsBusy] = useState(false);
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "offline">("loading");

  useEffect(() => { void loadSession(); }, []);

  async function loadSession() {
    try {
      const response = await fetch(`${apiUrl}/auth/me`, { credentials: "include" });
      if (response.status === 401 || response.status === 404) {
        router.replace("/connexion");
        return;
      }
      const payload = await readJson(response);
      const sessionUser = readUser(payload.user);
      if (!response.ok || !sessionUser) throw new Error("Session invalide.");
      setUser(sessionUser);
      setSessionState("ready");
      setMessage("Votre espace est à jour.");
      setMessageTone("success");
      await Promise.all([refreshDocuments(), refreshCases()]);
    } catch {
      setSessionState("offline");
      setMessage("Impossible de joindre le service Lydoc. Vérifiez que l’API est démarrée, puis réessayez.");
      setMessageTone("error");
    }
  }

  function selectFile(file: File | undefined) {
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      setMessage("Choisissez un document PDF, JPG ou PNG.");
      setMessageTone("error");
      return;
    }
    if (file.size > maxDocumentSizeBytes) {
      setMessage("Le document ne doit pas dépasser 20 Mo.");
      setMessageTone("error");
      return;
    }
    setSelectedFile(file);
    setMessage(`${file.name} est prêt à être déposé.`);
    setMessageTone("info");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) { selectFile(event.target.files?.[0]); }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setMessage("Choisissez d’abord une facture.");
      setMessageTone("error");
      return;
    }
    setIsBusy(true);
    setMessage("Chiffrement et dépôt de votre facture…");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ kind: "ORANGE_INVOICE", originalName: selectedFile.name, mimeType: selectedFile.type, contentBase64: await fileToBase64(selectedFile) }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, "Le dépôt n’a pas abouti."));
      const uploadedDocument = readDocument(payload.document);
      if (!uploadedDocument) throw new Error("La réponse reçue après le dépôt est invalide.");
      setDocuments((current) => [uploadedDocument, ...current]);
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setMessage("Facture déposée et chiffrée. Vous pouvez maintenant lancer l’analyse.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Le dépôt n’a pas abouti.");
      setMessageTone("error");
    } finally { setIsBusy(false); }
  }

  async function refreshDocuments() {
    try {
      const response = await fetch(`${apiUrl}/documents`, { credentials: "include" });
      const payload = await readJson(response);
      if (response.ok && Array.isArray(payload.documents)) setDocuments(payload.documents.flatMap((value) => { const document = readDocument(value); return document ? [document] : []; }));
    } catch { /* Keep the last successful list visible. */ }
  }

  async function refreshCases() {
    try {
      const response = await fetch(`${apiUrl}/cases`, { credentials: "include" });
      const payload = await readJson(response);
      if (response.ok && Array.isArray(payload.cases)) setCases(payload.cases.flatMap((value) => { const item = readCase(value); return item ? [item] : []; }));
    } catch { /* Keep the last successful list visible. */ }
  }

  async function analyzeInvoice(documentId: string) {
    setIsBusy(true);
    setMessage("Lecture de la facture et recherche des règlements applicables…");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/documents/${documentId}/analyze`, { method: "POST", credentials: "include" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, "L’analyse n’a pas abouti."));
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      await Promise.all([refreshDocuments(), refreshCases()]);
      setMessage(candidates.length > 0 ? "Bonne nouvelle : un règlement correspondant a été trouvé et un dossier a été créé." : "L’analyse est terminée. Aucun règlement suffisamment proche n’a été trouvé pour le moment.");
      setMessageTone(candidates.length > 0 ? "success" : "info");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "L’analyse n’a pas abouti.");
      setMessageTone("error");
    } finally { setIsBusy(false); }
  }

  if (sessionState === "loading") {
    return <div className="grid min-h-screen place-items-center bg-[#f5f7fb]"><div className="text-center"><LoaderCircle className="mx-auto animate-spin text-[#2457f5]" size={30} /><p className="mt-4 text-sm font-semibold text-[#667189]">Ouverture de votre espace…</p></div></div>;
  }

  if (sessionState === "offline" && !user) {
    return <div className="grid min-h-screen place-items-center bg-[#f5f7fb] px-5"><div className="surface max-w-lg p-7 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-[#fff0ec] text-[#e9654b]"><AlertCircle size={24} /></span><h1 className="mt-5 text-2xl font-extrabold text-[#102544]">Lydoc ne répond pas encore.</h1><p className="mt-3 text-sm leading-6 text-[#667189]">{message}</p><button type="button" onClick={() => { setSessionState("loading"); void loadSession(); }} className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white"><RefreshCw size={16} /> Réessayer</button></div></div>;
  }

  const recoverableCents = cases.reduce((total, item) => total + item.estimatedRecoverableCents, 0);
  const activeCases = cases.filter((item) => !["REFUNDED", "REJECTED"].includes(item.status)).length;
  const refundedCents = cases.filter((item) => item.status === "REFUNDED").reduce((total, item) => total + item.estimatedRecoverableCents, 0);
  const analyzedDocuments = documents.filter((document) => document.status === "ANALYZED").length;
  const firstName = user?.email.split("@").shift()?.split(/[._-]/).shift() ?? "vous";

  return (
    <AppShell email={user?.email} isAdmin={user?.role === "ADMIN"} active="dashboard">
      <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="text-sm font-semibold capitalize text-[#667189]">Bonjour {firstName}</p><h1 className="mt-1 text-2xl font-extrabold text-[#102544] sm:text-3xl">Voici où en sont vos remboursements.</h1></div>
          <a href="#deposer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#2457f5] px-4 text-sm font-extrabold text-white shadow-sm hover:bg-[#1947d8]"><Plus size={17} /> Déposer une facture</a>
        </div>

        <div className={`mt-6 flex items-start gap-3 border-l-4 p-4 text-sm leading-6 ${messageTone === "success" ? "border-[#16875b] bg-[#e8f7f0] text-[#326950]" : messageTone === "error" ? "border-[#e9654b] bg-[#fff0ec] text-[#8e3d2c]" : "border-[#2457f5] bg-[#eef3ff] text-[#344f8d]"}`} role="status">
          {messageTone === "success" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : messageTone === "error" ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <Sparkles size={18} className="mt-0.5 shrink-0" />}
          <span>{message}</span>
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Synthèse du compte">
          {[
            [CircleDollarSign, formatCents(recoverableCents), "Potentiel détecté", "Sur vos dossiers", "blue"],
            [FolderKanban, String(activeCases), "Dossiers en cours", cases.length ? `${cases.length} au total` : "Prêt à démarrer", "navy"],
            [FileCheck2, String(analyzedDocuments), "Factures analysées", `${documents.length} document${documents.length > 1 ? "s" : ""}`, "coral"],
            [WalletCards, formatCents(refundedCents), "Déjà remboursé", refundedCents ? "Versements confirmés" : "À venir", "green"],
          ].map(([Icon, value, label, detail, tone]) => {
            const MetricIcon = Icon as typeof CircleDollarSign;
            const color = tone === "green" ? "text-[#16875b] bg-[#e8f7f0]" : tone === "coral" ? "text-[#d9573f] bg-[#fff0ec]" : tone === "navy" ? "text-[#102544] bg-[#e8edf4]" : "text-[#2457f5] bg-[#e8efff]";
            return <article key={label as string} className="surface flex min-h-[128px] items-start justify-between gap-4 p-5"><div><p className="text-2xl font-extrabold text-[#102544]">{value as string}</p><p className="mt-2 text-sm font-extrabold text-[#34415d]">{label as string}</p><p className="mt-1 text-xs text-[#7a8499]">{detail as string}</p></div><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${color}`}><MetricIcon size={20} /></span></article>;
          })}
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1.18fr_0.82fr]">
          <form id="deposer" onSubmit={uploadDocument} className="surface scroll-mt-24 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-extrabold text-[#102544]">Analyser une nouvelle facture</h2><p className="mt-1 text-sm text-[#667189]">Déposez un PDF ou une photo lisible.</p></div><span className="hidden rounded-md bg-[#e8f7f0] px-3 py-2 text-xs font-extrabold text-[#16875b] sm:inline-flex">Analyse gratuite</span></div>
            <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg" onChange={handleFileChange} className="sr-only" />
            <div onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }} role="button" tabIndex={0} className="mt-5 flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-[#b8c6e8] bg-[#f8faff] p-6 text-center hover:border-[#2457f5] hover:bg-[#f2f6ff]">
              <span className="grid h-12 w-12 place-items-center rounded-md bg-[#e4ebff] text-[#2457f5]"><UploadCloud size={24} /></span>
              <p className="mt-4 max-w-md truncate text-sm font-extrabold text-[#26334f]">{selectedFile?.name ?? "Glissez votre facture ici"}</p>
              <p className="mt-1 text-xs text-[#7a8499]">{selectedFile ? `${formatBytes(selectedFile.size)} · Cliquez pour changer` : "ou cliquez pour parcourir vos fichiers"}</p>
              <p className="mt-3 text-[11px] font-semibold text-[#8b95a8]">PDF, JPG ou PNG · 20 Mo maximum</p>
            </div>
            <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><p className="flex items-center gap-2 text-xs text-[#667189]"><LockKeyhole size={14} className="text-[#16875b]" />Votre document sera stocké chiffré.</p><button disabled={isBusy || !selectedFile} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:cursor-not-allowed disabled:opacity-50">{isBusy ? <LoaderCircle size={17} className="animate-spin" /> : <FileSearch size={17} />} Déposer la facture</button></div>
          </form>

          <section className="surface flex flex-col p-5 sm:p-6">
            <div className="flex items-start justify-between"><div><p className="text-xs font-extrabold uppercase text-[#7a8499]">Prochaine action</p><h2 className="mt-2 text-lg font-extrabold text-[#102544]">{cases[0] ? formatNextAction(cases[0].status) : "Votre premier remboursement"}</h2></div><span className="grid h-10 w-10 place-items-center rounded-md bg-[#fff4e7] text-[#a95d12]"><ReceiptText size={20} /></span></div>
            {cases[0] ? <><p className="mt-5 text-sm leading-6 text-[#667189]">{cases[0].rule?.name ?? "Dossier administratif"} · {cases[0].rule?.organizer ?? "Organisateur"}</p><div className="mt-5 bg-[#f3f6fa] p-4"><p className="text-xs text-[#7a8499]">Montant estimé</p><p className="mt-1 text-2xl font-extrabold text-[#102544]">{formatCents(cases[0].estimatedRecoverableCents)}</p></div><a href={`/cases/${cases[0].id}`} className="mt-auto flex min-h-11 items-center justify-between border-t border-[#dce3ed] pt-5 text-sm font-extrabold text-[#2457f5]">Continuer mon dossier <ArrowRight size={17} /></a></> : <><p className="mt-5 text-sm leading-6 text-[#667189]">Déposez une facture : Lydoc la compare aux règlements disponibles et vous indique les démarches possibles.</p><ol className="mt-6 grid gap-3 text-sm text-[#536078]">{["Déposer la facture", "Lancer l’analyse", "Consulter le montant estimé"].map((item, index) => <li key={item} className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-md bg-[#e8efff] text-xs font-extrabold text-[#2457f5]">{index + 1}</span>{item}</li>)}</ol></>}
          </section>
        </section>

        <section id="documents" className="surface mt-6 scroll-mt-24 overflow-hidden">
          <div className="flex flex-col justify-between gap-3 border-b border-[#dce3ed] px-5 py-5 sm:flex-row sm:items-center sm:px-6"><div><h2 className="text-lg font-extrabold text-[#102544]">Mes documents</h2><p className="mt-1 text-sm text-[#667189]">Factures déposées et état de leur analyse.</p></div><span className="text-xs font-bold text-[#7a8499]">{documents.length} document{documents.length > 1 ? "s" : ""}</span></div>
          {documents.length === 0 ? <div className="px-5 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-[#edf2f8] text-[#667189]"><FileText size={23} /></span><p className="mt-4 text-sm font-extrabold text-[#34415d]">Aucune facture déposée</p><p className="mt-2 text-sm text-[#7a8499]">Votre première facture apparaîtra ici.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-left"><thead><tr className="bg-[#f8fafc] text-[11px] font-extrabold uppercase text-[#7a8499]"><th className="px-6 py-3">Document</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Taille</th><th className="px-4 py-3">Statut</th><th className="px-6 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-[#e6ebf1]">{documents.map((document) => <tr key={document.id} className="text-sm hover:bg-[#fbfcfe]"><td className="px-6 py-4"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-md bg-[#eef3ff] text-[#2457f5]"><FileText size={17} /></span><div className="min-w-0"><p className="max-w-[280px] truncate font-extrabold text-[#26334f]">{document.originalName}</p><p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#7a8499]"><LockKeyhole size={11} /> Chiffré</p></div></div></td><td className="px-4 py-4 text-[#5d6881]">{formatDocumentKind(document.kind)}</td><td className="px-4 py-4 text-[#5d6881]">{formatBytes(document.sizeBytes)}</td><td className="px-4 py-4"><StatusBadge status={document.status} /></td><td className="px-6 py-4 text-right">{document.kind === "ORANGE_INVOICE" && document.status !== "ANALYZED" ? <button type="button" disabled={isBusy} onClick={() => analyzeInvoice(document.id)} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#2457f5] px-3 text-xs font-extrabold text-white disabled:opacity-50"><Sparkles size={14} /> Analyser</button> : <span className="text-xs font-bold text-[#16875b]">Analyse terminée</span>}</td></tr>)}</tbody></table></div>}
        </section>

        <section id="dossiers" className="mt-6 scroll-mt-24">
          <div className="flex items-end justify-between gap-4"><div><h2 className="text-lg font-extrabold text-[#102544]">Mes dossiers</h2><p className="mt-1 text-sm text-[#667189]">Suivez les prochaines étapes jusqu’au remboursement.</p></div></div>
          {cases.length === 0 ? <div className="surface mt-4 px-5 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-[#edf2f8] text-[#667189]"><FolderKanban size={23} /></span><p className="mt-4 text-sm font-extrabold text-[#34415d]">Aucun dossier pour le moment</p><p className="mt-2 text-sm text-[#7a8499]">Un dossier sera créé dès qu’un règlement correspondant sera identifié.</p></div> : <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cases.map((item) => <article key={item.id} className="surface p-5"><div className="flex items-start justify-between gap-4"><span className="grid h-10 w-10 place-items-center rounded-md bg-[#e8efff] text-[#2457f5]"><ReceiptText size={20} /></span><StatusBadge status={item.status} /></div><h3 className="mt-5 truncate text-base font-extrabold text-[#102544]">{item.rule?.name ?? "Dossier administratif"}</h3><p className="mt-1 text-xs text-[#7a8499]">{item.rule?.organizer ?? "Organisateur"}</p><div className="mt-5 flex items-end justify-between border-y border-[#e2e8f0] py-4"><div><p className="text-xs text-[#7a8499]">Montant estimé</p><p className="mt-1 text-xl font-extrabold text-[#102544]">{formatCents(item.estimatedRecoverableCents)}</p></div>{item.confidence !== null ? <p className="text-xs font-bold text-[#667189]">Confiance {Math.round(item.confidence * 100)} %</p> : null}</div><a href={`/cases/${item.id}`} className="mt-4 flex items-center justify-between text-sm font-extrabold text-[#2457f5]">Ouvrir le dossier <ChevronRight size={17} /></a></article>)}</div>}
        </section>

        <section id="remboursements" className="mt-6 scroll-mt-24 border-y border-[#dce3ed] py-6"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div className="flex items-center gap-4"><span className="grid h-11 w-11 place-items-center rounded-md bg-[#e8f7f0] text-[#16875b]"><CircleDollarSign size={22} /></span><div><h2 className="font-extrabold text-[#102544]">Historique des remboursements</h2><p className="mt-1 text-sm text-[#667189]">Vos versements confirmés apparaîtront ici.</p></div></div><p className="text-2xl font-extrabold text-[#16875b]">{formatCents(refundedCents)}</p></div></section>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = formatStatus(status);
  const success = ["ANALYZED", "READY_TO_PAY", "SENT", "REFUNDED"].includes(status);
  const warning = ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "UPLOADED"].includes(status);
  return <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-extrabold ${success ? "bg-[#e8f7f0] text-[#16875b]" : warning ? "bg-[#fff4e7] text-[#a95d12]" : "bg-[#edf2f8] text-[#536078]"}`}><span className={`status-dot ${success ? "bg-[#16875b]" : warning ? "bg-[#d47a22]" : "bg-[#7a8499]"}`} />{label}</span>;
}

async function fileToBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { if (typeof reader.result !== "string") return reject(new Error("Impossible de lire le document.")); const separator = reader.result.indexOf(","); if (separator === -1) return reject(new Error("Impossible de préparer le document.")); resolve(reader.result.slice(separator + 1)); }; reader.onerror = () => reject(new Error("Impossible de lire le document.")); reader.readAsDataURL(file); }); }
async function readJson(response: Response): Promise<Record<string, unknown>> { try { const value: unknown = await response.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return {}; } }
function errorMessage(payload: Record<string, unknown>, fallback: string): string { if (typeof payload.message === "string") return payload.message; if (Array.isArray(payload.message) && payload.message.every((item) => typeof item === "string")) return payload.message.join(" "); return fallback; }
function readUser(value: unknown): User | null { if (!value || typeof value !== "object") return null; const user = value as Record<string, unknown>; return typeof user.id === "string" && typeof user.email === "string" && typeof user.role === "string" ? { id: user.id, email: user.email, role: user.role } : null; }
function readDocument(value: unknown): UploadedDocument | null { if (!value || typeof value !== "object") return null; const document = value as Record<string, unknown>; return typeof document.id === "string" && typeof document.kind === "string" && typeof document.status === "string" && typeof document.originalName === "string" && typeof document.mimeType === "string" && typeof document.sizeBytes === "number" && typeof document.encrypted === "boolean" ? { id: document.id, kind: document.kind, status: document.status, originalName: document.originalName, mimeType: document.mimeType, sizeBytes: document.sizeBytes, encrypted: document.encrypted } : null; }
function readCase(value: unknown): AdministrativeCase | null { if (!value || typeof value !== "object") return null; const item = value as Record<string, unknown>; const rawRule = item.rule; const rule = rawRule && typeof rawRule === "object" ? rawRule as Record<string, unknown> : null; if (typeof item.id !== "string" || typeof item.status !== "string" || typeof item.estimatedRecoverableCents !== "number" || typeof item.serviceFeeCents !== "number" || (item.confidence !== null && typeof item.confidence !== "number") || (rule && (typeof rule.id !== "string" || typeof rule.name !== "string" || typeof rule.organizer !== "string"))) return null; return { id: item.id, status: item.status, estimatedRecoverableCents: item.estimatedRecoverableCents, serviceFeeCents: item.serviceFeeCents, confidence: item.confidence as number | null, rule: rule ? { id: rule.id as string, name: rule.name as string, organizer: rule.organizer as string } : null }; }
function formatBytes(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`; }
function formatCents(cents: number): string { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100); }
function formatDocumentKind(kind: string): string { return kind === "ORANGE_INVOICE" ? "Facture opérateur" : kind === "IDENTITY_DOCUMENT" ? "Pièce d’identité" : kind === "BANK_DETAILS" ? "RIB" : "Document"; }
function formatStatus(status: string): string { const labels: Record<string, string> = { UPLOADED: "Déposé", ANALYZED: "Analysé", DRAFT: "À préparer", WAITING_FOR_USER_DOCUMENTS: "Pièces attendues", READY_TO_PAY: "Prêt au paiement", PAID: "Payé", SENT: "Envoyé", REFUNDED: "Remboursé", REJECTED: "Refusé" }; return labels[status] ?? status; }
function formatNextAction(status: string): string { return status === "DRAFT" ? "Préparer votre dossier" : status === "WAITING_FOR_USER_DOCUMENTS" ? "Ajouter les pièces demandées" : status === "READY_TO_PAY" ? "Valider votre dossier" : status === "SENT" ? "Suivre la demande" : "Consulter le dossier"; }
