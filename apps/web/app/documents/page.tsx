"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { apiFetch as fetch } from "../../lib/api-client";
import { AppShell } from "../../components/app-shell";
import { DetectionReviewCard } from "../../components/detection-review-card";
import {
  JourneySteps,
  LoadingState,
  Notice,
  StatusBadge,
  type NoticeTone,
} from "../../components/client-ui";
import {
  apiUrl,
  errorMessage,
  formatBytes,
  formatCents,
  formatDocumentKind,
  gamePeriodLabel,
  readDocument,
  readGameCatalog,
  readJson,
  readList,
  readUser,
  type UploadedDocument,
  type GameChannel,
  type User,
} from "../../lib/client-data";

const maxDocumentSizeBytes = 20 * 1024 * 1024;
const allowedTypes = ["application/pdf"];

type View = "list" | "upload" | "result";
type AnalysisResult = {
  eligible: boolean;
  ruleMatched: boolean;
  caseId: string | null;
  amountCents: number;
  smsCount: number;
  ruleName: string;
  shortCodes: string[];
};

export default function DocumentsPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [gameCatalog, setGameCatalog] = useState<GameChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [selectedGameRuleId, setSelectedGameRuleId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [aiConsentAccepted, setAiConsentAccepted] = useState(false);
  const [existingDocument, setExistingDocument] =
    useState<UploadedDocument | null>(null);
  const [view, setView] = useState<View>("list");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<NoticeTone>("info");
  const [isBusy, setIsBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadPage();
  }, []);

  async function loadPage() {
    try {
      const [sessionResponse, documentsResponse, catalogResponse] =
        await Promise.all([
          fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
          fetch(`${apiUrl}/documents`, { credentials: "include" }),
          fetch(`${apiUrl}/games/catalog`),
        ]);
      if (sessionResponse.status === 401 || sessionResponse.status === 404) {
        router.replace("/connexion");
        return;
      }
      const [sessionPayload, documentsPayload, catalogPayload] =
        await Promise.all([
          readJson(sessionResponse),
          readJson(documentsResponse),
          readJson(catalogResponse),
        ]);
      const sessionUser = readUser(sessionPayload.user);
      if (
        !sessionResponse.ok ||
        !documentsResponse.ok ||
        !catalogResponse.ok ||
        !sessionUser
      )
        throw new Error("Chargement impossible.");

      const loadedDocuments = readList(
        documentsPayload.documents,
        readDocument,
      );
      setUser(sessionUser);
      setDocuments(loadedDocuments);
      setGameCatalog(readGameCatalog(catalogPayload.channels));
      setView(
        new URLSearchParams(window.location.search).get("new") === "1" ||
          loadedDocuments.length === 0
          ? "upload"
          : "list",
      );
    } catch {
      setMessage(
        "Impossible de joindre le service Lydoc. Vérifiez que l’API est démarrée.",
      );
      setTone("error");
    } finally {
      setLoading(false);
    }
  }

  function openUpload() {
    setView("upload");
    setAnalysis(null);
    setExistingDocument(null);
    setSelectedChannelId("");
    setSelectedGameRuleId("");
    setAiConsentAccepted(false);
    setMessage("");
    window.history.replaceState(null, "", "/documents?new=1");
  }

  function openList() {
    setView("list");
    setSelectedFile(null);
    setExistingDocument(null);
    setSelectedChannelId("");
    setSelectedGameRuleId("");
    setAiConsentAccepted(false);
    setAnalysis(null);
    setMessage("");
    window.history.replaceState(null, "", "/documents");
  }

  function configureExistingDocument(document: UploadedDocument) {
    setExistingDocument(document);
    setSelectedFile(null);
    setSelectedChannelId("");
    setSelectedGameRuleId("");
    setAiConsentAccepted(false);
    setAnalysis(null);
    setMessage("");
    setView("upload");
    window.history.replaceState(null, "", `/documents?analyze=${document.id}`);
  }

  function selectFile(file: File | undefined) {
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      setMessage("Choisissez une facture au format PDF.");
      setTone("error");
      return;
    }
    if (file.size > maxDocumentSizeBytes) {
      setMessage("Le document ne doit pas dépasser 20 Mo.");
      setTone("error");
      return;
    }
    setSelectedFile(file);
    setExistingDocument(null);
    setMessage("");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    selectFile(event.dataTransfer.files[0]);
  }

  async function uploadAndAnalyze() {
    if (!selectedFile && !existingDocument) {
      setMessage("Choisissez d’abord une facture.");
      setTone("error");
      return;
    }
    if (!selectedGameRuleId) {
      setMessage("Sélectionnez d’abord la chaîne puis le jeu concours.");
      setTone("error");
      return;
    }
    if (!aiConsentAccepted) {
      setMessage(
        "Confirmez votre accord pour l’analyse de cette facture par Mistral.",
      );
      setTone("error");
      return;
    }

    setIsBusy(true);
    setMessage(
      "Votre facture est chiffrée, puis analysée par Lydoc. Cela peut prendre quelques instants.",
    );
    setTone("info");
    try {
      let documentId = existingDocument?.id ?? "";
      if (selectedFile) {
        const form = new FormData();
        form.set("kind", "ORANGE_INVOICE");
        form.set("file", selectedFile, selectedFile.name);
        const uploadResponse = await fetch(`${apiUrl}/documents`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        const uploadPayload = await readJson(uploadResponse);
        const document = readDocument(uploadPayload.document);
        if (!uploadResponse.ok || !document) {
          throw new Error(
            errorMessage(uploadPayload, "Le dépôt n’a pas abouti."),
          );
        }
        documentId = document.id;
        setDocuments((current) => [
          document,
          ...current.filter((item) => item.id !== document.id),
        ]);
      }
      await analyzeDocument(documentId, selectedGameRuleId);
      setSelectedFile(null);
      setExistingDocument(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "L’analyse n’a pas abouti.",
      );
      setTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function analyzeDocument(documentId: string, gameRuleId: string) {
    setIsBusy(true);
    setMessage("Lecture de la facture et recherche des SMS surtaxés...");
    setTone("info");
    try {
      const response = await fetch(
        `${apiUrl}/documents/${documentId}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            gameRuleId,
            aiProcessingConsentAccepted: true,
          }),
        },
      );
      const payload = await readJson(response);
      if (!response.ok)
        throw new Error(errorMessage(payload, "L’analyse n’a pas abouti."));

      const result = readAnalysis(payload);
      setAnalysis(result);
      setView("result");
      setMessage("");
      window.history.replaceState(null, "", "/documents?result=1");
      await refreshDocuments();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "L’analyse n’a pas abouti.",
      );
      setTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshDocuments() {
    const response = await fetch(`${apiUrl}/documents`, {
      credentials: "include",
    });
    const payload = await readJson(response);
    if (response.ok) setDocuments(readList(payload.documents, readDocument));
  }

  async function deleteDocument(document: UploadedDocument) {
    if (!window.confirm(`Supprimer « ${document.originalName} » ?`)) return;
    setIsBusy(true);
    setMessage("Suppression sécurisée du document...");
    setTone("info");
    try {
      const response = await fetch(`${apiUrl}/documents/${document.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, "Impossible de supprimer ce document."),
        );
      }
      setDocuments((current) =>
        current.filter((item) => item.id !== document.id),
      );
      setMessage("Le document a été retiré. Sa purge chiffrée est programmée.");
      setTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Suppression impossible.",
      );
      setTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmDetection(smsCount: number, amountCents: number) {
    if (!analysis?.caseId) return;
    setIsBusy(true);
    setMessage("Enregistrement de votre vérification...");
    setTone("info");
    try {
      const response = await fetch(
        `${apiUrl}/cases/${analysis.caseId}/detection`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ smsCount, amountCents }),
        },
      );
      const payload = await readJson(response);
      const rawCase =
        payload.case && typeof payload.case === "object"
          ? (payload.case as Record<string, unknown>)
          : null;
      if (!response.ok || !rawCase || typeof rawCase.id !== "string") {
        throw new Error(
          errorMessage(payload, "Impossible d’enregistrer votre vérification."),
        );
      }
      setAnalysis((current) =>
        current ? { ...current, smsCount, amountCents } : current,
      );
      router.push(`/cases/${rawCase.id}`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible d’enregistrer votre vérification.",
      );
      setTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  if (loading) return <LoadingState label="Chargement de vos documents..." />;

  return (
    <AppShell
      active="documents"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="mx-auto w-full max-w-[1340px] px-4 pb-7 pt-4 sm:px-6 lg:px-8 lg:pb-8">
        {view === "list" ? (
          <DocumentList
            documents={documents}
            isBusy={isBusy}
            message={message}
            tone={tone}
            onAnalyze={configureExistingDocument}
            onDelete={deleteDocument}
            onUpload={openUpload}
          />
        ) : view === "upload" ? (
          <UploadView
            selectedFile={selectedFile}
            existingDocument={existingDocument}
            gameCatalog={gameCatalog}
            selectedChannelId={selectedChannelId}
            selectedGameRuleId={selectedGameRuleId}
            aiConsentAccepted={aiConsentAccepted}
            inputRef={inputRef}
            isBusy={isBusy}
            message={message}
            tone={tone}
            onBack={openList}
            onDrop={handleDrop}
            onFileChange={handleFileChange}
            onChoose={() => inputRef.current?.click()}
            onChannelChange={(channelId) => {
              setSelectedChannelId(channelId);
              setSelectedGameRuleId("");
            }}
            onGameChange={setSelectedGameRuleId}
            onAiConsentChange={setAiConsentAccepted}
            onRemove={() => {
              setSelectedFile(null);
              setExistingDocument(null);
              setMessage("");
              if (inputRef.current) inputRef.current.value = "";
            }}
            onAnalyze={uploadAndAnalyze}
          />
        ) : analysis ? (
          <ResultView
            result={analysis}
            isBusy={isBusy}
            message={message}
            tone={tone}
            onConfirm={confirmDetection}
            onBack={openList}
            onAnother={openUpload}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

function DocumentList({
  documents,
  isBusy,
  message,
  tone,
  onAnalyze,
  onDelete,
  onUpload,
}: {
  documents: UploadedDocument[];
  isBusy: boolean;
  message: string;
  tone: NoticeTone;
  onAnalyze: (document: UploadedDocument) => void;
  onDelete: (document: UploadedDocument) => void;
  onUpload: () => void;
}) {
  const analyzedCount = documents.filter(
    (document) => document.status === "ANALYZED",
  ).length;
  const processingCount = documents.filter((document) =>
    ["UPLOADED", "OCR_PENDING", "OCR_DONE", "ANALYSIS_PENDING"].includes(
      document.status,
    ),
  ).length;
  const encryptedCount = documents.filter(
    (document) => document.encrypted,
  ).length;

  return (
    <>
      <div className="mb-3 flex items-center justify-end gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onUpload}
          disabled={isBusy}
          className="primary-button min-h-11 w-full px-5 text-sm shadow-[0_10px_24px_rgba(8,122,85,0.18)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Analyser une facture <UploadCloud size={17} />
        </button>
        <NotificationLink />
      </div>

      <section
        aria-labelledby="documents-title"
        className="relative overflow-hidden rounded-[14px] border border-[#efe9df] bg-[#fffcf6] shadow-[0_12px_38px_rgba(61,68,54,0.045)]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 72% 18%, rgba(255,255,255,0.98), rgba(255,255,255,0.38) 34%, transparent 55%), linear-gradient(112deg, #fff9ef 0%, #fffdf9 54%, #fff9ed 100%)",
        }}
      >
        <div className="grid min-h-[220px] lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative z-10 flex flex-col justify-center px-6 py-8 sm:px-9 lg:px-10">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#77847d]">
              Votre espace documentaire
            </p>
            <h1
              id="documents-title"
              className="mt-3 max-w-[540px] text-[30px] font-black leading-[1.08] tracking-[-0.025em] text-[#142a22] sm:text-[35px] lg:text-[38px]"
            >
              Vos documents, bien{" "}
              <span className="text-[#07865e] underline decoration-[#f1ad2b] decoration-[3px] underline-offset-[5px]">
                organisés
              </span>
            </h1>
            <p className="mt-5 max-w-[520px] text-sm leading-6 text-[#708078]">
              Retrouvez vos fichiers chiffrés, analysez vos factures et suivez
              leur traitement depuis un seul endroit.
            </p>
          </div>

          <div className="relative hidden min-h-[220px] lg:block">
            <Image
              src="/illustrations/dashboard-mascot.png"
              alt=""
              width={1214}
              height={1295}
              sizes="190px"
              className="pointer-events-none absolute -bottom-9 left-[12%] h-auto w-[190px] select-none object-contain lg:left-[17%] lg:w-[205px]"
            />
            <div className="absolute right-[7%] top-9 rounded-[11px] border border-white/90 bg-white/95 px-4 py-3 shadow-[0_12px_30px_rgba(45,71,59,0.1)]">
              <span className="flex items-center gap-2 text-[11px] font-extrabold text-[#23362d]">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#e5f4ec] text-[#087a55]">
                  <FileText size={14} />
                </span>
                {documents.length} document{documents.length !== 1 ? "s" : ""}
              </span>
              <span className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-[#728078]">
                <LockKeyhole size={12} className="text-[#087a55]" /> Stockage
                chiffré
              </span>
            </div>
            <div className="absolute bottom-8 right-[13%] rounded-full border border-[#cde4d8] bg-[#eff9f4] px-3 py-2 text-[10px] font-extrabold text-[#087a55] shadow-[0_8px_20px_rgba(45,71,59,0.07)]">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={13} /> {analyzedCount} analysé
                {analyzedCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
      </section>

      {message ? (
        <div className="mt-4">
          <Notice tone={tone} busy={isBusy}>
            {message}
          </Notice>
        </div>
      ) : null}

      <section
        className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicateurs des documents"
      >
        <DocumentMetric
          label="Documents déposés"
          value={String(documents.length)}
          detail="Dans votre espace"
          icon={FileText}
          tone="mint"
        />
        <DocumentMetric
          label="Documents analysés"
          value={String(analyzedCount)}
          detail="Analyse terminée"
          icon={FileCheck2}
          tone="green"
        />
        <DocumentMetric
          label="En cours de traitement"
          value={String(processingCount)}
          detail="OCR ou analyse"
          icon={ScanLine}
          tone="amber"
        />
        <DocumentMetric
          label="Documents chiffrés"
          value={String(encryptedCount)}
          detail="Protégés par Lydoc"
          icon={ShieldCheck}
          tone="coral"
        />
      </section>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(300px,0.78fr)]">
        <section
          aria-labelledby="recent-documents-title"
          className="overflow-hidden rounded-[12px] border border-[#e1e8e4] bg-white shadow-[0_12px_34px_rgba(27,63,47,0.05)]"
        >
          <div className="flex items-center justify-between gap-4 px-5 pb-3 pt-5 sm:px-6">
            <div>
              <h2
                id="recent-documents-title"
                className="text-[17px] font-extrabold text-[#1a2822]"
              >
                Mes documents récents
              </h2>
              <p className="mt-1 text-[11px] text-[#7b8781]">
                Analysez ou relancez une facture quand vous le souhaitez.
              </p>
            </div>
            <button
              type="button"
              onClick={onUpload}
              disabled={isBusy}
              className="group hidden min-h-11 items-center gap-1.5 text-xs font-extrabold text-[#087a55] hover:text-[#056846] disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
            >
              Nouvelle facture
              <ArrowRight
                size={14}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </button>
          </div>

          {documents.length === 0 ? (
            <div className="mx-3 mb-3 grid min-h-[270px] place-items-center rounded-[10px] border border-dashed border-[#cbdad2] bg-[#fbfdfc] px-5 py-10 text-center sm:mx-4 sm:mb-4">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e8f6ef] text-[#087a55]">
                  <FileText size={22} />
                </span>
                <h3 className="mt-4 text-base font-extrabold text-[#24332c]">
                  Aucun document pour le moment
                </h3>
                <p className="mt-2 text-sm text-[#66736d]">
                  Votre première facture apparaîtra ici après son analyse.
                </p>
                <button
                  type="button"
                  onClick={onUpload}
                  className="primary-button mt-5 min-h-11 px-5 text-xs"
                >
                  <Plus size={15} /> Ajouter une facture
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-3 mb-3 overflow-hidden rounded-[10px] border border-[#e2e9e5] sm:mx-4 sm:mb-4">
              <div className="hidden grid-cols-[minmax(0,1fr)_130px_120px_190px] gap-3 bg-[#f8faf9] px-5 py-3 text-[10px] font-extrabold uppercase tracking-[0.04em] text-[#849089] lg:grid">
                <span>Document</span>
                <span>Type</span>
                <span>Statut</span>
                <span className="text-right">Actions</span>
              </div>
              <div className="divide-y divide-[#e7ece9]">
                {documents.map((document) => (
                  <article
                    key={document.id}
                    className="grid gap-4 px-4 py-4 transition-colors hover:bg-[#f8faf9] sm:px-5 lg:grid-cols-[minmax(0,1fr)_130px_120px_190px] lg:items-center lg:gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] bg-[#e9f5ef] text-[#087a55]">
                        <FileText size={18} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-extrabold text-[#24332c]">
                          {document.originalName}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#7b8781]">
                          {document.watermarked ? (
                            <ShieldCheck size={12} />
                          ) : (
                            <LockKeyhole size={12} />
                          )}
                          {document.watermarked
                            ? "Filigrané et chiffré"
                            : "Chiffré"}
                          <span aria-hidden="true">·</span>
                          {formatBytes(document.sizeBytes)}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs font-semibold text-[#66736d] lg:block">
                      <span className="mr-1 text-[10px] font-bold uppercase text-[#96a09b] lg:hidden">
                        Type :
                      </span>
                      {formatDocumentKind(document.kind)}
                    </p>
                    <div>
                      <StatusBadge status={document.status} />
                    </div>
                    <div className="flex items-center gap-2 lg:justify-end">
                      {document.kind === "ORANGE_INVOICE" ? (
                        <button
                          type="button"
                          onClick={() => onAnalyze(document)}
                          disabled={isBusy}
                          className="secondary-button min-h-11 flex-1 px-3 text-xs lg:flex-none"
                        >
                          {isBusy ? (
                            <LoaderCircle className="animate-spin" size={14} />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          {document.status === "ANALYZED"
                            ? "Relancer l’analyse"
                            : "Analyser"}
                        </button>
                      ) : (
                        <span className="flex-1 text-xs font-bold text-[#087a55] lg:flex-none">
                          Protégé
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(document)}
                        disabled={isBusy}
                        title="Supprimer le document"
                        aria-label={`Supprimer ${document.originalName}`}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-[9px] border border-[#dce5e0] text-[#7b8781] transition-colors hover:border-[#efb9ad] hover:bg-[#fff0ec] hover:text-[#b94a35] disabled:opacity-40"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="rounded-[12px] border border-[#e1e8e4] bg-white p-5 shadow-[0_12px_34px_rgba(27,63,47,0.05)] sm:p-6 xl:sticky xl:top-5">
          <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-[#e5f4ec] text-[#087a55]">
            <ShieldCheck size={20} />
          </span>
          <h2 className="mt-4 text-base font-extrabold text-[#1a2822]">
            Vos documents restent privés
          </h2>
          <p className="mt-2 text-xs leading-5 text-[#728078]">
            Chaque fichier est chiffré dès son dépôt et utilisé uniquement pour
            votre démarche.
          </p>
          <div className="my-5 h-px bg-[#e6ece9]" />
          <h3 className="text-xs font-extrabold uppercase tracking-[0.06em] text-[#7a8780]">
            Comment ça marche ?
          </h3>
          <ol className="mt-4 grid gap-4">
            {[
              ["1", "Vous déposez un PDF", "Format PDF, jusqu’à 20 Mo."],
              ["2", "Lydoc lit la facture", "Les frais SMS+ sont repérés."],
              ["3", "Vous validez le résultat", "Rien n’est envoyé sans vous."],
            ].map(([number, title, description]) => (
              <li key={number} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0b8a61] text-[10px] font-black text-white">
                  {number}
                </span>
                <span className="pt-0.5">
                  <span className="block text-xs font-bold text-[#2c3b34]">
                    {title}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-[#7b8781]">
                    {description}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <DocumentsReassuranceStrip />
    </>
  );
}

function DocumentMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "mint" | "green" | "amber" | "coral";
}) {
  const styles = {
    mint: "bg-[#e3f3eb] text-[#16865e]",
    green: "bg-[#e8f6ef] text-[#087a55]",
    amber: "bg-[#fff4d6] text-[#dc9207]",
    coral: "bg-[#ffede8] text-[#e4664e]",
  } satisfies Record<typeof tone, string>;

  return (
    <article className="relative min-h-[132px] overflow-hidden rounded-[11px] border border-[#dfe7e3] bg-white p-5 shadow-[0_10px_30px_rgba(27,63,47,0.045)]">
      <p className="text-xs font-semibold text-[#34433d]">{label}</p>
      <p className="mt-2 text-[25px] font-black leading-none tracking-[-0.02em] text-[#14221c]">
        {value}
      </p>
      <p className="mt-4 text-[11px] font-bold text-[#7a8780]">{detail}</p>
      <span
        aria-hidden="true"
        className={`absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-[9px] ${styles[tone]}`}
      >
        <Icon size={21} strokeWidth={1.8} />
      </span>
    </article>
  );
}

function NotificationLink() {
  return (
    <a
      href="/notifications"
      aria-label="Consulter les alertes"
      className="relative hidden h-11 w-11 shrink-0 place-items-center rounded-xl text-[#1b3128] transition-colors hover:bg-[#eef6f1] lg:grid"
    >
      <Bell size={21} strokeWidth={1.9} />
      <span
        aria-hidden="true"
        className="absolute right-2.5 top-2 h-2 w-2 rounded-full border-2 border-white bg-[#ff5f50]"
      />
    </a>
  );
}

function DocumentsReassuranceStrip() {
  const items = [
    {
      title: "Chiffré",
      description: "Chaque document est protégé dès son dépôt.",
      icon: ShieldCheck,
    },
    {
      title: "Vérifiable",
      description: "Vous gardez la main sur les données détectées.",
      icon: FileCheck2,
    },
    {
      title: "Rapide",
      description: "L’analyse vous guide vers la prochaine étape.",
      icon: Clock3,
    },
  ];

  return (
    <section
      aria-label="Les engagements Lydoc"
      className="relative mt-4 overflow-hidden rounded-[12px] border border-[#dfe7e3] bg-white shadow-[0_10px_30px_rgba(27,63,47,0.04)]"
    >
      <div className="grid md:grid-cols-3">
        {items.map(({ title, description, icon: Icon }, index) => (
          <div
            key={title}
            className={`flex min-h-[98px] items-center gap-4 px-5 py-5 sm:px-7 ${
              index > 0
                ? "border-t border-[#e5ebe8] md:border-l md:border-t-0"
                : ""
            } ${index === 2 ? "md:pr-24 xl:pr-32" : ""}`}
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e5f4ec] text-[#07865e]">
              <Icon size={22} strokeWidth={1.8} />
            </span>
            <span>
              <span className="block text-xs font-extrabold text-[#087a55]">
                {title}
              </span>
              <span className="mt-1 block max-w-[240px] text-[11px] leading-[1.55] text-[#77847d]">
                {description}
              </span>
            </span>
          </div>
        ))}
      </div>
      <Image
        src="/illustrations/dashboard-botanical-sprig.png"
        alt=""
        width={1024}
        height={1536}
        sizes="110px"
        className="pointer-events-none absolute -bottom-10 right-1 hidden h-[132px] w-auto select-none object-contain md:block"
      />
    </section>
  );
}

function UploadView({
  selectedFile,
  existingDocument,
  gameCatalog,
  selectedChannelId,
  selectedGameRuleId,
  aiConsentAccepted,
  inputRef,
  isBusy,
  message,
  tone,
  onBack,
  onDrop,
  onFileChange,
  onChoose,
  onChannelChange,
  onGameChange,
  onAiConsentChange,
  onRemove,
  onAnalyze,
}: {
  selectedFile: File | null;
  existingDocument: UploadedDocument | null;
  gameCatalog: GameChannel[];
  selectedChannelId: string;
  selectedGameRuleId: string;
  aiConsentAccepted: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isBusy: boolean;
  message: string;
  tone: NoticeTone;
  onBack: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onChoose: () => void;
  onChannelChange: (channelId: string) => void;
  onGameChange: (gameRuleId: string) => void;
  onAiConsentChange: (accepted: boolean) => void;
  onRemove: () => void;
  onAnalyze: () => Promise<void>;
}) {
  const selectedChannel = gameCatalog.find(
    (channel) => channel.id === selectedChannelId,
  );
  const selectedGame = selectedChannel?.games.find(
    (game) => game.id === selectedGameRuleId,
  );
  const invoiceName =
    selectedFile?.name ?? existingDocument?.originalName ?? "";
  const invoiceSize = selectedFile?.size ?? existingDocument?.sizeBytes ?? 0;
  const hasInvoice = Boolean(selectedFile || existingDocument);
  const canAnalyze =
    hasInvoice && Boolean(selectedGameRuleId) && aiConsentAccepted && !isBusy;
  const preparationSteps = [
    {
      label: "Jeu sélectionné",
      detail: selectedGame?.name ?? "À choisir",
      complete: Boolean(selectedGame),
    },
    {
      label: "Facture ajoutée",
      detail: invoiceName || "PDF attendu",
      complete: hasInvoice,
    },
    {
      label: "Accord Mistral",
      detail: aiConsentAccepted ? "Consentement confirmé" : "À confirmer",
      complete: aiConsentAccepted,
    },
  ];
  const completedPreparation = preparationSteps.filter(
    (step) => step.complete,
  ).length;
  const currentPreparation = preparationSteps.findIndex(
    (step) => !step.complete,
  );

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isBusy}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-bold text-[#66736d] hover:text-[#087a55] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Retour aux documents</span>
          <span className="sm:hidden">Retour</span>
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => void onAnalyze()}
            disabled={!canAnalyze}
            className="primary-button hidden min-h-11 px-5 text-sm shadow-[0_10px_24px_rgba(8,122,85,0.16)] sm:inline-flex"
          >
            {isBusy ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            Lancer l’analyse
          </button>
          <NotificationLink />
        </div>
      </div>

      <section
        aria-labelledby="upload-title"
        className="relative overflow-hidden rounded-[14px] border border-[#efe9df] bg-[#fffaf2] px-6 py-7 shadow-[0_12px_38px_rgba(61,68,54,0.045)] sm:px-9 lg:min-h-[212px] lg:px-10"
        style={{
          backgroundImage:
            "radial-gradient(circle at 78% 20%, rgba(255,255,255,0.98), rgba(255,255,255,0.32) 38%, transparent 58%), linear-gradient(112deg, #fff9ef 0%, #fffdf9 100%)",
        }}
      >
        <div className="relative z-10 max-w-[690px]">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#087a55]">
            Nouvelle analyse
          </p>
          <h1
            id="upload-title"
            className="mt-3 text-[30px] font-black leading-[1.08] tracking-[-0.025em] text-[#142a22] sm:text-[36px]"
          >
            Analyser une facture
          </h1>
          <p className="mt-4 max-w-[590px] text-sm leading-6 text-[#708078]">
            Indiquez le jeu appelé, ajoutez votre PDF puis confirmez l’analyse
            sécurisée. Lydoc s’occupe du reste.
          </p>
          <ol
            className="mt-5 grid max-w-[570px] grid-cols-3 gap-2"
            aria-label="Préparation de l’analyse"
          >
            {preparationSteps.map((step, index) => (
              <li
                key={step.label}
                className={`flex min-h-11 items-center gap-2 rounded-[9px] border px-2.5 py-2 text-[10px] font-bold sm:px-3 ${
                  step.complete
                    ? "border-[#b9ddcc] bg-[#eff9f4] text-[#087a55]"
                    : index === currentPreparation
                      ? "border-[#efcd8d] bg-[#fff8e8] text-[#966016]"
                      : "border-[#e4e8e5] bg-white/80 text-[#87928c]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-black ${
                    step.complete
                      ? "bg-[#087a55] text-white"
                      : "bg-[#edf1ef] text-[#7c8982]"
                  }`}
                >
                  {step.complete ? (
                    <Check size={11} strokeWidth={3} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="truncate">{step.label}</span>
              </li>
            ))}
          </ol>
        </div>
        <Image
          src="/illustrations/dashboard-mascot.png"
          alt=""
          width={1214}
          height={1295}
          sizes="180px"
          className="pointer-events-none absolute -bottom-10 right-[4%] hidden h-auto w-[180px] select-none object-contain xl:block"
        />
      </section>

      {message ? (
        <div className="mt-4">
          <Notice tone={tone} busy={isBusy}>
            {message}
          </Notice>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={onFileChange}
        disabled={isBusy}
        className="sr-only"
      />
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.62fr)]">
        <div className="grid gap-4">
          <section
            aria-labelledby="game-selection-title"
            className="rounded-[12px] border border-[#e1e8e4] bg-white p-5 shadow-[0_12px_34px_rgba(27,63,47,0.05)] sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#e8f6ef] text-sm font-extrabold text-[#087a55]">
                1
              </span>
              <div>
                <h2
                  id="game-selection-title"
                  className="text-base font-extrabold text-[#17211d]"
                >
                  Quel jeu avez-vous appelé ?
                </h2>
                <p className="mt-1 text-xs leading-5 text-[#66736d]">
                  Votre choix permet d’appliquer le bon règlement au numéro
                  court détecté.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-xs font-extrabold text-[#34433d]">
                Chaîne
                <select
                  value={selectedChannelId}
                  onChange={(event) => onChannelChange(event.target.value)}
                  disabled={isBusy}
                  className="field bg-white text-sm"
                >
                  <option value="">Sélectionnez une chaîne</option>
                  {gameCatalog.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-xs font-extrabold text-[#34433d]">
                Jeu concours
                <select
                  value={selectedGameRuleId}
                  onChange={(event) => onGameChange(event.target.value)}
                  disabled={!selectedChannel || isBusy}
                  className="field bg-white text-sm disabled:bg-[#f2f5f3]"
                >
                  <option value="">
                    {selectedChannel
                      ? "Sélectionnez un jeu"
                      : "Choisissez d’abord la chaîne"}
                  </option>
                  {selectedChannel?.games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedGame ? (
              <p className="mt-4 flex items-center gap-2 rounded-[9px] bg-[#f0f8f4] px-3 py-2.5 text-xs font-semibold text-[#526058]">
                <CheckCircle2 size={15} className="shrink-0 text-[#087a55]" />
                <span>
                  {selectedGame.name} · {gamePeriodLabel(selectedGame)}
                </span>
              </p>
            ) : null}
            {gameCatalog.length === 0 ? (
              <p className="mt-4 text-xs font-bold text-[#a34732]">
                Aucun règlement approuvé n’est disponible pour le moment.
              </p>
            ) : null}
          </section>

          <section
            aria-labelledby="invoice-upload-title"
            className="rounded-[12px] border border-[#e1e8e4] bg-white p-5 shadow-[0_12px_34px_rgba(27,63,47,0.05)] sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#fff3d6] text-sm font-extrabold text-[#d88d05]">
                2
              </span>
              <div>
                <h2
                  id="invoice-upload-title"
                  className="text-base font-extrabold text-[#17211d]"
                >
                  Ajoutez votre facture
                </h2>
                <p className="mt-1 text-xs leading-5 text-[#66736d]">
                  Un PDF lisible suffit. Sa taille ne doit pas dépasser 20 Mo.
                </p>
              </div>
            </div>

            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                if (isBusy) {
                  event.preventDefault();
                  return;
                }
                onDrop(event);
              }}
              onClick={isBusy ? undefined : onChoose}
              onKeyDown={(event) => {
                if (isBusy) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChoose();
                }
              }}
              role="button"
              aria-disabled={isBusy}
              tabIndex={isBusy ? -1 : 0}
              className={`mt-5 flex min-h-[205px] cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 px-6 text-center transition-colors ${
                hasInvoice
                  ? "border-solid border-[#9bceb6] bg-[#f2faf6] hover:bg-[#ebf7f1]"
                  : "border-dashed border-[#b7cec2] bg-[#fbfdfc] hover:border-[#087a55] hover:bg-[#f2f8f5]"
              } ${isBusy ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <span
                className={`grid h-12 w-12 place-items-center rounded-full ${
                  hasInvoice
                    ? "bg-[#087a55] text-white"
                    : "bg-[#e7f4ed] text-[#087a55]"
                }`}
              >
                {hasInvoice ? (
                  <Check size={22} strokeWidth={2.7} />
                ) : (
                  <UploadCloud size={23} strokeWidth={1.8} />
                )}
              </span>
              <h3 className="mt-4 text-[15px] font-extrabold text-[#24332c]">
                {existingDocument
                  ? "Votre facture est déjà disponible"
                  : selectedFile
                    ? "Votre facture est prête"
                    : "Déposez votre PDF ici"}
              </h3>
              <p className="mt-2 text-xs leading-5 text-[#728078]">
                {hasInvoice
                  ? "Cliquez pour choisir un autre fichier si nécessaire."
                  : "Glissez-déposez le fichier ou parcourez votre appareil."}
              </p>
              <span className="secondary-button pointer-events-none mt-4 min-h-10 px-4 text-xs">
                {hasInvoice ? "Remplacer le fichier" : "Choisir un fichier"}
              </span>
            </div>

            {hasInvoice ? (
              <div className="mt-4 flex min-w-0 items-center gap-3 rounded-[9px] border border-[#d6e5de] bg-white px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[#e8f6ef] text-[#087a55]">
                  <FileText size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-extrabold text-[#24332c]">
                    {invoiceName}
                  </p>
                  <p className="mt-1 text-[10px] font-semibold text-[#7b8781]">
                    PDF · {formatBytes(invoiceSize)} · prêt pour l’analyse
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={isBusy}
                  title="Retirer le fichier"
                  aria-label="Retirer le fichier"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-[#7b8781] transition-colors hover:bg-[#fff0ec] hover:text-[#b94a35] disabled:opacity-40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : null}
          </section>

          <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-[#e1e8e4] bg-white p-5 text-xs leading-5 text-[#59665f] shadow-[0_12px_34px_rgba(27,63,47,0.05)] sm:p-6">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#ffede8] text-sm font-extrabold text-[#df654d]">
              3
            </span>
            <input
              type="checkbox"
              checked={aiConsentAccepted}
              onChange={(event) => onAiConsentChange(event.target.checked)}
              disabled={isBusy}
              className="mt-2 h-4 w-4 shrink-0 accent-[#087a55]"
            />
            <span>
              <span className="block text-sm font-extrabold text-[#24332c]">
                Autoriser l’analyse assistée
              </span>
              <span className="mt-1.5 block leading-5 text-[#66736d]">
                J’accepte que cette facture opérateur soit transmise à Mistral
                afin d’en extraire les informations utiles. Je confirme qu’il ne
                s’agit ni d’une pièce d’identité ni d’un RIB.
              </span>
            </span>
          </label>
        </div>

        <aside className="rounded-[12px] border border-[#e1e8e4] bg-white p-5 shadow-[0_12px_34px_rgba(27,63,47,0.06)] sm:p-6 lg:sticky lg:top-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#7a8780]">
                Votre préparation
              </p>
              <h2 className="mt-1.5 text-base font-extrabold text-[#17211d]">
                Prêt pour l’analyse ?
              </h2>
            </div>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#e8f6ef] text-sm font-black text-[#087a55]">
              {completedPreparation}/3
            </span>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#edf1ef]">
            <span
              className="block h-full rounded-full bg-[#087a55] transition-[width]"
              style={{ width: `${(completedPreparation / 3) * 100}%` }}
            />
          </div>
          <ol className="mt-6 grid gap-4">
            {preparationSteps.map((step, index) => (
              <li key={step.label} className="flex min-w-0 gap-3">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[10px] font-extrabold ${
                    step.complete
                      ? "border-[#087a55] bg-[#087a55] text-white"
                      : "border-[#ccd7d1] bg-white text-[#7b8781]"
                  }`}
                >
                  {step.complete ? (
                    <Check size={13} strokeWidth={3} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="block text-xs font-extrabold text-[#34433d]">
                    {step.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#7b8781]">
                    {step.detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <div className="my-6 h-px bg-[#e5ebe8]" />
          <div className="flex gap-3 rounded-[9px] bg-[#f1f8f4] p-3.5">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[#087a55]" />
            <p className="text-[11px] leading-5 text-[#66736d]">
              Votre PDF est chiffré avant la lecture et reste associé uniquement
              à votre compte.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onAnalyze()}
            disabled={!canAnalyze}
            className="primary-button mt-5 min-h-12 w-full text-sm shadow-[0_10px_24px_rgba(8,122,85,0.16)]"
          >
            {isBusy ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <Sparkles size={17} />
            )}
            Analyser ma facture
          </button>
          {!canAnalyze && !isBusy ? (
            <p className="mt-3 text-center text-[10px] leading-4 text-[#87928c]">
              Complétez les trois étapes pour lancer l’analyse.
            </p>
          ) : null}
        </aside>
      </div>

      <DocumentsReassuranceStrip />
    </>
  );
}

function ResultView({
  result,
  isBusy,
  message,
  tone,
  onConfirm,
  onBack,
  onAnother,
}: {
  result: AnalysisResult;
  isBusy: boolean;
  message: string;
  tone: NoticeTone;
  onConfirm: (smsCount: number, amountCents: number) => Promise<void>;
  onBack: () => void;
  onAnother: () => void;
}) {
  if (!result.eligible || !result.caseId) {
    return (
      <>
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={isBusy}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-bold text-[#66736d] hover:text-[#087a55] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Retour aux documents</span>
            <span className="sm:hidden">Retour</span>
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onAnother}
              disabled={isBusy}
              className="primary-button min-h-11 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:text-sm"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Nouvelle analyse</span>
              <span className="sm:hidden">Analyser</span>
            </button>
            <NotificationLink />
          </div>
        </div>

        <section
          aria-labelledby="empty-result-title"
          className="relative overflow-hidden rounded-[14px] border border-[#e7e9e4] bg-[#fbfcfa] shadow-[0_12px_38px_rgba(61,68,54,0.045)]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 76% 20%, rgba(255,255,255,0.98), rgba(255,255,255,0.3) 38%, transparent 58%), linear-gradient(112deg, #f7faf8 0%, #fffdf9 100%)",
          }}
        >
          <div className="grid min-h-[240px] lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative z-10 flex flex-col justify-center px-6 py-8 sm:px-9 lg:px-10">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#d8e1dc] bg-white px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#65736c]">
                <CheckCircle2 size={13} className="text-[#087a55]" /> Analyse
                terminée
              </span>
              <h1
                id="empty-result-title"
                className="mt-4 max-w-[650px] text-[29px] font-black leading-[1.1] tracking-[-0.025em] text-[#142a22] sm:text-[35px]"
              >
                Aucun SMS remboursable identifié
              </h1>
              <p className="mt-4 max-w-[570px] text-sm leading-6 text-[#708078]">
                Nous n’avons trouvé aucun frais correspondant au jeu
                sélectionné. Votre facture reste disponible et protégée dans vos
                documents.
              </p>
            </div>
            <div className="relative hidden min-h-[240px] sm:block">
              <Image
                src="/illustrations/dashboard-mascot.png"
                alt=""
                width={1214}
                height={1295}
                sizes="190px"
                className="pointer-events-none absolute -bottom-8 left-[20%] h-auto w-[190px] select-none object-contain"
              />
              <div className="absolute right-[8%] top-10 rounded-[11px] border border-white bg-white/95 px-4 py-3 shadow-[0_12px_30px_rgba(45,71,59,0.1)]">
                <span className="flex items-center gap-2 text-xs font-extrabold text-[#24332c]">
                  <ShieldCheck size={16} className="text-[#087a55]" /> Facture
                  conservée
                </span>
                <span className="mt-1 block text-[10px] text-[#7b8781]">
                  Chiffrée dans votre espace
                </span>
              </div>
            </div>
          </div>
        </section>

        {message ? (
          <div className="mt-4">
            <Notice tone={tone} busy={isBusy}>
              {message}
            </Notice>
          </div>
        ) : null}

        <section className="mt-4 grid overflow-hidden rounded-[12px] border border-[#e1e8e4] bg-white shadow-[0_12px_34px_rgba(27,63,47,0.05)] md:grid-cols-3">
          {[
            {
              title: "Lecture terminée",
              description: "La facture a bien été parcourue par Lydoc.",
              icon: ScanLine,
            },
            {
              title: "Aucun montant retenu",
              description: "Aucun SMS ne correspond au règlement choisi.",
              icon: FileCheck2,
            },
            {
              title: "Document disponible",
              description:
                "Vous pouvez le relancer ou le supprimer à tout moment.",
              icon: LockKeyhole,
            },
          ].map(({ title, description, icon: Icon }, index) => (
            <div
              key={title}
              className={`flex min-h-[128px] items-start gap-4 p-5 sm:p-6 ${
                index > 0
                  ? "border-t border-[#e5ebe8] md:border-l md:border-t-0"
                  : ""
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] bg-[#e8f6ef] text-[#087a55]">
                <Icon size={19} />
              </span>
              <span>
                <span className="block text-xs font-extrabold text-[#24332c]">
                  {title}
                </span>
                <span className="mt-1.5 block text-[11px] leading-5 text-[#77847d]">
                  {description}
                </span>
              </span>
            </div>
          ))}
        </section>

        <div className="mt-4 flex flex-col justify-end gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onBack}
            disabled={isBusy}
            className="secondary-button disabled:cursor-not-allowed disabled:opacity-50"
          >
            Voir mes documents
          </button>
          <button
            type="button"
            onClick={onAnother}
            disabled={isBusy}
            className="primary-button disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} /> Analyser une autre facture
          </button>
        </div>

        <DocumentsReassuranceStrip />
      </>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isBusy}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-bold text-[#66736d] hover:text-[#087a55] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Retour aux documents</span>
          <span className="sm:hidden">Retour</span>
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onAnother}
            disabled={isBusy}
            className="secondary-button min-h-11 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:text-sm"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Nouvelle analyse</span>
            <span className="sm:hidden">Analyser</span>
          </button>
          <NotificationLink />
        </div>
      </div>

      <section
        aria-labelledby="analysis-result-title"
        className="relative overflow-hidden rounded-[14px] border border-[#e7eadf] bg-[#fffaf2] shadow-[0_12px_38px_rgba(61,68,54,0.045)]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 74% 18%, rgba(255,255,255,0.98), rgba(255,255,255,0.34) 38%, transparent 58%), linear-gradient(112deg, #fff9ef 0%, #fffdf9 100%)",
        }}
      >
        <div className="grid min-h-[240px] lg:grid-cols-[1.18fr_0.82fr]">
          <div className="relative z-10 flex flex-col justify-center px-6 py-8 sm:px-9 lg:px-10">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#bfe1d1] bg-[#eff9f4] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#087a55]">
              <CheckCircle2 size={13} /> Analyse terminée
            </span>
            <h1
              id="analysis-result-title"
              className="mt-4 max-w-[700px] text-[29px] font-black leading-[1.1] tracking-[-0.025em] text-[#142a22] sm:text-[35px] lg:text-[38px]"
            >
              {result.ruleMatched
                ? `${formatCents(result.amountCents)} remboursables`
                : `${formatCents(result.amountCents)} de frais SMS+ détectés`}
            </h1>
            <p className="mt-4 max-w-[630px] text-sm leading-6 text-[#708078]">
              {result.ruleMatched ? (
                <>
                  Lydoc a identifié {result.smsCount} SMS surtaxé
                  {result.smsCount > 1 ? "s" : ""} lié
                  {result.smsCount > 1 ? "s" : ""} à {result.ruleName}. Vérifiez
                  les données avant de préparer votre dossier.
                </>
              ) : (
                <>
                  {result.smsCount} achat{result.smsCount > 1 ? "s" : ""} SMS+
                  au code {result.shortCodes.join(", ") || "court"} identifié
                  {result.smsCount > 1 ? "s" : ""}. Le règlement exact reste à
                  confirmer.
                </>
              )}
            </p>
          </div>
          <div className="relative hidden min-h-[240px] sm:block">
            <Image
              src="/illustrations/dashboard-mascot.png"
              alt=""
              width={1214}
              height={1295}
              sizes="200px"
              className="pointer-events-none absolute -bottom-9 left-[16%] h-auto w-[200px] select-none object-contain"
            />
            <div className="absolute right-[7%] top-9 min-w-[150px] rounded-[11px] border border-white bg-white/95 p-4 shadow-[0_12px_30px_rgba(45,71,59,0.11)]">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#77847d]">
                Montant détecté
              </span>
              <strong className="mt-1 block text-2xl font-black text-[#087a55]">
                {formatCents(result.amountCents)}
              </strong>
              <span className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-[#64736b]">
                <CheckCircle2 size={12} className="text-[#087a55]" /> À vérifier
                par vos soins
              </span>
            </div>
          </div>
        </div>
      </section>

      {message ? (
        <div className="mt-4">
          <Notice tone={tone} busy={isBusy}>
            {message}
          </Notice>
        </div>
      ) : null}

      <section className="mt-4 rounded-[12px] border border-[#e1e8e4] bg-white px-5 py-5 shadow-[0_12px_34px_rgba(27,63,47,0.05)] sm:px-7 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-extrabold text-[#1a2822]">
              Votre dossier commence ici
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-[#77847d]">
              La détection est terminée. Après votre confirmation, Lydoc vous
              guide jusqu’au remboursement.
            </p>
          </div>
          <span className="hidden rounded-full bg-[#e8f6ef] px-3 py-1.5 text-[10px] font-extrabold text-[#087a55] sm:inline-flex">
            Étape 2 sur 5
          </span>
        </div>
        <div className="mt-5">
          <JourneySteps current={1} />
        </div>
      </section>

      <section className="mt-4 grid overflow-hidden rounded-[12px] border border-[#e1e8e4] bg-white shadow-[0_12px_34px_rgba(27,63,47,0.05)] md:grid-cols-2">
        <div className="relative min-h-[150px] p-5 sm:p-6">
          <p className="text-xs font-semibold text-[#66736d]">
            {result.ruleMatched ? "Remboursement détecté" : "Frais détectés"}
          </p>
          <p className="mt-3 text-[31px] font-black tracking-[-0.025em] text-[#17211d]">
            {formatCents(result.amountCents)}
          </p>
          <p className="mt-2 text-xs font-bold text-[#087a55]">
            {result.smsCount} SMS surtaxé{result.smsCount > 1 ? "s" : ""}
          </p>
          <span className="absolute bottom-5 right-5 grid h-11 w-11 place-items-center rounded-[10px] bg-[#e8f6ef] text-[#087a55]">
            <FileCheck2 size={21} />
          </span>
        </div>
        <div className="relative min-h-[150px] border-t border-[#e5ebe8] p-5 sm:p-6 md:border-l md:border-t-0">
          <p className="text-xs font-semibold text-[#66736d]">
            {result.ruleMatched
              ? "Règlement correspondant"
              : "Identification du règlement"}
          </p>
          <p className="mt-3 max-w-[78%] text-base font-extrabold text-[#17211d]">
            {result.ruleName}
          </p>
          <p
            className={`mt-2 flex items-center gap-1.5 text-xs font-extrabold ${
              result.ruleMatched ? "text-[#087a55]" : "text-[#9b6319]"
            }`}
          >
            {result.ruleMatched ? (
              <>
                <CheckCircle2 size={15} /> Éligible
              </>
            ) : (
              <>
                <Clock3 size={15} /> Vérification requise
              </>
            )}
          </p>
          <span className="absolute bottom-5 right-5 grid h-11 w-11 place-items-center rounded-[10px] bg-[#fff3d6] text-[#d88d05]">
            <ScanLine size={21} />
          </span>
        </div>
      </section>

      <section className="mt-4 rounded-[12px] border border-[#e1e8e4] bg-white p-5 shadow-[0_12px_34px_rgba(27,63,47,0.05)] sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] bg-[#e8f6ef] text-[#087a55]">
            <CheckCircle2 size={19} />
          </span>
          <div>
            <h2 className="text-lg font-extrabold text-[#17211d]">
              Confirmez les informations lues
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#66736d]">
              Corrigez si nécessaire le nombre de SMS ou le montant avant de
              préparer votre dossier.
            </p>
          </div>
        </div>
        <div className="mt-5">
          <DetectionReviewCard
            smsCount={result.smsCount}
            amountCents={result.amountCents}
            isBusy={isBusy}
            submitLabel="Confirmer et préparer"
            onSubmit={onConfirm}
          />
        </div>
        <button
          type="button"
          onClick={onBack}
          disabled={isBusy}
          className="mx-auto mt-4 block min-h-10 text-xs font-bold text-[#66736d] hover:text-[#087a55] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Je le ferai plus tard
        </button>
      </section>

      <DocumentsReassuranceStrip />
    </>
  );
}

function readAnalysis(payload: Record<string, unknown>): AnalysisResult {
  const rawCase =
    payload.case && typeof payload.case === "object"
      ? (payload.case as Record<string, unknown>)
      : null;
  const rawDocument =
    payload.document && typeof payload.document === "object"
      ? (payload.document as Record<string, unknown>)
      : null;
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : [];
  const candidate =
    candidates[0] && typeof candidates[0] === "object"
      ? (candidates[0] as Record<string, unknown>)
      : null;
  return {
    eligible: Boolean(rawCase),
    ruleMatched: Boolean(candidate),
    caseId: rawCase && typeof rawCase.id === "string" ? rawCase.id : null,
    amountCents:
      rawCase && typeof rawCase.estimatedRecoverableCents === "number"
        ? rawCase.estimatedRecoverableCents
        : candidate && typeof candidate.reimbursementCents === "number"
          ? candidate.reimbursementCents
          : 0,
    smsCount:
      rawDocument && typeof rawDocument.participationCount === "number"
        ? rawDocument.participationCount
        : 0,
    ruleName:
      candidate && typeof candidate.ruleName === "string"
        ? candidate.ruleName
        : "Frais SMS+ détectés",
    shortCodes:
      rawDocument && Array.isArray(rawDocument.detectedSmsCharges)
        ? [
            ...new Set(
              rawDocument.detectedSmsCharges.flatMap((charge) => {
                if (!charge || typeof charge !== "object") return [];
                const code = (charge as Record<string, unknown>).code;
                return typeof code === "string" ? [code] : [];
              }),
            ),
          ]
        : [],
  };
}
