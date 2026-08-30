"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { apiFetch as fetch } from "../../lib/api-client";
import { AppShell } from "../../components/app-shell";
import { PageHeading } from "../../components/cockpit-ui";
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
      <div className="page-container py-7 sm:py-9">
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
  return (
    <>
      <PageHeading
        eyebrow="Votre coffre documentaire"
        title="Documents sécurisés"
        description="Vos factures et justificatifs chiffrés, réunis au même endroit."
        action={
          <button
            type="button"
            onClick={onUpload}
            className="primary-button min-h-10 self-start px-4 text-xs sm:self-auto"
          >
            <Plus size={15} /> Nouvelle facture
          </button>
        }
      />

      {message ? (
        <div className="mt-6">
          <Notice tone={tone} busy={isBusy}>
            {message}
          </Notice>
        </div>
      ) : null}

      <section className="surface mt-6 overflow-hidden">
        {documents.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <FileText className="mx-auto text-[#99a59f]" size={28} />
            <h2 className="mt-4 text-lg font-extrabold text-[#24332c]">
              Aucun document
            </h2>
            <p className="mt-2 text-sm text-[#66736d]">
              Votre première facture apparaîtra ici après son analyse.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_180px_150px_170px] gap-4 bg-[#f8faf9] px-6 py-3 text-[10px] font-extrabold uppercase text-[#849089] sm:grid">
              <span>Document</span>
              <span>Type</span>
              <span>Statut</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-[#e7ece9]">
              {documents.map((document) => (
                <article
                  key={document.id}
                  className="grid gap-4 px-5 py-5 transition-colors hover:bg-[#f8faf9] sm:grid-cols-[minmax(0,1fr)_180px_150px_170px] sm:items-center sm:px-6"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#e9f5ef] text-[#087a55]">
                      <FileText size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-[#24332c]">
                        {document.originalName}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-[#7b8781]">
                        {document.watermarked ? (
                          <ShieldCheck size={12} />
                        ) : (
                          <LockKeyhole size={12} />
                        )}{" "}
                        {document.watermarked
                          ? "Filigrané et chiffré"
                          : "Chiffré"}{" "}
                        · {formatBytes(document.sizeBytes)}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-[#66736d]">
                    {formatDocumentKind(document.kind)}
                  </p>
                  <div>
                    <StatusBadge status={document.status} />
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    {document.kind === "ORANGE_INVOICE" ? (
                      <button
                        type="button"
                        onClick={() => onAnalyze(document)}
                        disabled={isBusy}
                        className="secondary-button min-h-9 px-3 text-xs"
                      >
                        {isBusy ? (
                          <LoaderCircle className="animate-spin" size={14} />
                        ) : (
                          <Sparkles size={14} />
                        )}{" "}
                        {document.status === "ANALYZED"
                          ? "Relancer l’analyse"
                          : "Analyser"}
                      </button>
                    ) : (
                      <span className="text-xs font-bold text-[#087a55]">
                        Protégé
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(document)}
                      disabled={isBusy}
                      title="Supprimer le document"
                      aria-label="Supprimer le document"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#dce5e0] text-[#7b8781] hover:border-[#efb9ad] hover:bg-[#fff0ec] hover:text-[#b94a35] disabled:opacity-40"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
      <p className="mt-5 flex items-center justify-center gap-2 text-xs text-[#7b8781]">
        <LockKeyhole size={13} /> Tous vos fichiers sont stockés chiffrés.
      </p>
    </>
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

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-[#66736d] hover:text-[#087a55]"
      >
        <ArrowLeft size={16} /> Retour aux documents
      </button>
      <div className="mt-6">
        <PageHeading
          eyebrow="Nouvelle analyse"
          title="Analyser une facture"
          description="Importez votre facture opérateur. Lydoc recherche les SMS surtaxés éligibles au remboursement."
        />
      </div>

      {message ? (
        <div className="mt-6">
          <Notice tone={tone} busy={isBusy}>
            {message}
          </Notice>
        </div>
      ) : null}

      <section className="surface mt-6 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#e8f6ef] text-sm font-extrabold text-[#087a55]">
            1
          </span>
          <div>
            <h2 className="text-base font-extrabold text-[#17211d]">
              Quel jeu avez-vous appelé ?
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#66736d]">
              Le même numéro court peut être utilisé par plusieurs jeux. Votre
              choix détermine le règlement appliqué.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold text-[#24332c]">
            Chaîne
            <select
              value={selectedChannelId}
              onChange={(event) => onChannelChange(event.target.value)}
              disabled={isBusy}
              className="field bg-white"
            >
              <option value="">Sélectionnez une chaîne</option>
              {gameCatalog.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-bold text-[#24332c]">
            Jeu concours
            <select
              value={selectedGameRuleId}
              onChange={(event) => onGameChange(event.target.value)}
              disabled={!selectedChannel || isBusy}
              className="field bg-white disabled:bg-[#f2f5f3]"
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
          <p className="mt-4 border-l-2 border-[#16875b] pl-3 text-xs font-semibold text-[#526058]">
            {selectedGame.name} · {gamePeriodLabel(selectedGame)}
          </p>
        ) : null}
        {gameCatalog.length === 0 ? (
          <p className="mt-4 text-xs font-bold text-[#a34732]">
            Aucun règlement approuvé n’est disponible pour le moment.
          </p>
        ) : null}
      </section>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={onFileChange}
        className="sr-only"
      />
      <div className="surface mt-6 grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="p-5 sm:p-6">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            onClick={onChoose}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onChoose();
            }}
            role="button"
            tabIndex={0}
            className="flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-[#b7cec2] bg-[#fbfcfb] px-6 text-center transition-colors hover:border-[#087a55] hover:bg-[#f2f8f5]"
          >
            <UploadCloud
              size={38}
              strokeWidth={1.7}
              className="text-[#087a55]"
            />
            <h2 className="mt-5 text-lg font-extrabold text-[#24332c]">
              {existingDocument
                ? "Facture déjà déposée"
                : "Déposez votre facture"}
            </h2>
            <p className="mt-2 text-sm text-[#66736d]">
              {existingDocument
                ? "Vous pouvez la remplacer si nécessaire."
                : "PDF · 20 Mo maximum"}
            </p>
            <span className="primary-button pointer-events-none mt-5 min-h-10 text-xs">
              {existingDocument
                ? "Choisir une autre facture"
                : "Choisir un fichier"}
            </span>
          </div>
        </div>
        <aside className="border-t border-[#e3e9e6] bg-[#f8faf9] p-5 sm:p-6 lg:border-l lg:border-t-0">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-[#e7f4ed] text-[#087a55]">
            <ShieldCheck size={18} />
          </span>
          <h2 className="mt-4 text-sm font-extrabold text-[#24332c]">
            Analyse sécurisée
          </h2>
          <p className="mt-2 text-xs leading-5 text-[#718079]">
            Votre document est chiffré avant la lecture OCR et n’est utilisé que
            pour votre demande.
          </p>
          <ol className="mt-6 grid gap-4">
            {["Jeu choisi", "Facture", "Analyse OCR", "Vérification"].map(
              (label, index) => (
                <li key={label} className="flex items-center gap-3">
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full border text-[11px] font-extrabold ${
                      index <= 1
                        ? "border-[#087a55] bg-[#087a55] text-white"
                        : "border-[#cdd7d2] bg-white text-[#7b8781]"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="text-xs font-bold text-[#59665f]">
                    {label}
                  </span>
                </li>
              ),
            )}
          </ol>
        </aside>
      </div>

      {selectedFile || existingDocument ? (
        <div className="mt-5 grid gap-4 rounded-md border border-[#d6e0db] bg-white px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <FileText size={20} className="shrink-0 text-[#087a55]" />
            <p className="truncate text-sm font-extrabold text-[#24332c]">
              {invoiceName}
            </p>
            <span className="shrink-0 text-sm text-[#66736d]">
              {formatBytes(invoiceSize)}
            </span>
          </div>
          <p className="flex items-center gap-2 text-sm font-bold text-[#087a55]">
            <CheckCircle2 size={17} /> Prête à être analysée
          </p>
          <button
            type="button"
            onClick={onRemove}
            disabled={isBusy}
            title="Retirer le fichier"
            aria-label="Retirer le fichier"
            className="grid h-9 w-9 place-items-center rounded-md text-[#66736d] hover:bg-[#fff0ec] hover:text-[#b94a35]"
          >
            <Trash2 size={17} />
          </button>
        </div>
      ) : null}

      <label className="mt-6 flex items-start gap-3 rounded-md border border-[#d6e0db] bg-white p-4 text-xs leading-5 text-[#59665f]">
        <input
          type="checkbox"
          checked={aiConsentAccepted}
          onChange={(event) => onAiConsentChange(event.target.checked)}
          disabled={isBusy}
          className="mt-1 h-4 w-4 accent-[#087a55]"
        />
        <span>
          J’accepte que cette facture opérateur soit transmise à Mistral pour
          en extraire les informations nécessaires à cette analyse. Je confirme
          qu’il ne s’agit ni d’une pièce d’identité ni d’un RIB.
        </span>
      </label>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => void onAnalyze()}
          disabled={
            (!selectedFile && !existingDocument) ||
            !selectedGameRuleId ||
            !aiConsentAccepted ||
            isBusy
          }
          className="primary-button min-w-[230px]"
        >
          {isBusy ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <Sparkles size={17} />
          )}{" "}
          Analyser ma facture
        </button>
      </div>

      <div className="mt-10 grid gap-4 border-t border-[#e3e9e6] pt-6 text-sm text-[#59665f] sm:grid-cols-3">
        <Reassurance icon={<Check size={16} />} label="Analyse gratuite" />
        <Reassurance
          icon={<ShieldCheck size={16} />}
          label="Document chiffré"
        />
        <Reassurance
          icon={<Clock3 size={16} />}
          label="Résultat en quelques minutes"
        />
      </div>
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
      <div className="mx-auto max-w-3xl py-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f1f4f8] text-[#66736d]">
          <FileText size={22} />
        </span>
        <p className="mt-5 text-xs font-extrabold uppercase text-[#7c8982]">
          Analyse terminée
        </p>
        <h1 className="mt-3 text-3xl font-extrabold text-[#17211d]">
          Aucun SMS remboursable identifié
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#66736d]">
          La facture reste disponible dans vos documents. Vous pouvez en
          analyser une autre à tout moment.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={onAnother} className="primary-button">
            Analyser une autre facture
          </button>
          <button type="button" onClick={onBack} className="secondary-button">
            Voir mes documents
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-[#66736d] hover:text-[#087a55]"
      >
        <ArrowLeft size={16} /> Retour aux documents
      </button>
      <div className="mx-auto mt-7 max-w-[940px] text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[#b7ddca] text-[#087a55]">
          <Check size={22} strokeWidth={2.5} />
        </span>
        <p className="mt-5 text-xs font-extrabold uppercase text-[#087a55]">
          Analyse terminée
        </p>
        <h1 className="mt-3 text-3xl font-extrabold text-[#17211d] sm:text-4xl">
          {result.ruleMatched
            ? `Bonne nouvelle, ${formatCents(result.amountCents)} sont remboursables`
            : `${formatCents(result.amountCents)} de frais SMS+ détectés`}
        </h1>
        <p className="mt-4 text-base text-[#66736d]">
          {result.ruleMatched ? (
            <>
              Nous avons identifié {result.smsCount} SMS surtaxé
              {result.smsCount > 1 ? "s" : ""} lié
              {result.smsCount > 1 ? "s" : ""} à {result.ruleName}.
            </>
          ) : (
            <>
              {result.smsCount} achat{result.smsCount > 1 ? "s" : ""} SMS+ au
              code {result.shortCodes.join(", ") || "court"} identifié
              {result.smsCount > 1 ? "s" : ""}. Le règlement exact doit encore
              être vérifié.
            </>
          )}
        </p>

        <div className="mx-auto mt-8 max-w-[760px]">
          <JourneySteps current={1} />
        </div>

        <section className="surface mt-8 grid overflow-hidden text-left md:grid-cols-2 md:divide-x md:divide-[#e3e9e6]">
          <div className="p-6 sm:p-8">
            <p className="text-sm font-extrabold text-[#24332c]">
              {result.ruleMatched ? "Remboursement détecté" : "Frais détectés"}
            </p>
            <p className="mt-4 text-4xl font-extrabold text-[#17211d]">
              {formatCents(result.amountCents)}
            </p>
            <p className="mt-3 text-sm text-[#66736d]">
              {result.smsCount} SMS surtaxé{result.smsCount > 1 ? "s" : ""}
            </p>
          </div>
          <div className="border-t border-[#e3e9e6] p-6 sm:p-8 md:border-t-0">
            <p className="text-sm font-extrabold text-[#24332c]">
              {result.ruleMatched
                ? "Règlement correspondant"
                : "Identification du règlement"}
            </p>
            <p className="mt-4 text-lg font-extrabold text-[#17211d]">
              {result.ruleName}
            </p>
            <p
              className={`mt-3 flex items-center gap-2 text-sm font-bold ${
                result.ruleMatched ? "text-[#087a55]" : "text-[#9b6319]"
              }`}
            >
              {result.ruleMatched ? (
                <>
                  <CheckCircle2 size={17} /> Éligible
                </>
              ) : (
                <>
                  <Clock3 size={17} /> Vérification requise
                </>
              )}
            </p>
          </div>
        </section>

        <h2 className="mt-9 text-xl font-extrabold text-[#17211d]">
          Confirmez les informations lues sur la facture
        </h2>
        <p className="mt-3 text-sm text-[#66736d]">
          Vous pouvez corriger le nombre de SMS ou le montant avant de préparer
          le dossier.
        </p>
        {message ? (
          <div className="mt-6 text-left">
            <Notice tone={tone} busy={isBusy}>
              {message}
            </Notice>
          </div>
        ) : null}
        <div className="mt-6 text-left">
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
          className="mx-auto mt-4 block text-sm font-bold text-[#66736d] hover:text-[#087a55]"
        >
          Je le ferai plus tard
        </button>
      </div>
    </>
  );
}

function Reassurance({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <p className="flex items-center justify-center gap-2">
      <span className="text-[#087a55]">{icon}</span>
      {label}
    </p>
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
