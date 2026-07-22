"use client";

import {
  ArrowLeft,
  ArrowRight,
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
import { AppShell } from "../../components/app-shell";
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
  fileToBase64,
  formatBytes,
  formatCents,
  formatDocumentKind,
  readDocument,
  readJson,
  readList,
  readUser,
  type UploadedDocument,
  type User,
} from "../../lib/client-data";

const maxDocumentSizeBytes = 20 * 1024 * 1024;
const allowedTypes = ["application/pdf", "image/png", "image/jpeg"];

type View = "list" | "upload" | "result";
type AnalysisResult = {
  eligible: boolean;
  caseId: string | null;
  amountCents: number;
  smsCount: number;
  ruleName: string;
};

export default function DocumentsPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
      const [sessionResponse, documentsResponse] = await Promise.all([
        fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
        fetch(`${apiUrl}/documents`, { credentials: "include" }),
      ]);
      if (sessionResponse.status === 401 || sessionResponse.status === 404) {
        router.replace("/connexion");
        return;
      }
      const [sessionPayload, documentsPayload] = await Promise.all([
        readJson(sessionResponse),
        readJson(documentsResponse),
      ]);
      const sessionUser = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !documentsResponse.ok || !sessionUser)
        throw new Error("Chargement impossible.");

      const loadedDocuments = readList(
        documentsPayload.documents,
        readDocument,
      );
      setUser(sessionUser);
      setDocuments(loadedDocuments);
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
    setMessage("");
    window.history.replaceState(null, "", "/documents?new=1");
  }

  function openList() {
    setView("list");
    setSelectedFile(null);
    setAnalysis(null);
    setMessage("");
    window.history.replaceState(null, "", "/documents");
  }

  function selectFile(file: File | undefined) {
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      setMessage("Choisissez un document PDF, JPG ou PNG.");
      setTone("error");
      return;
    }
    if (file.size > maxDocumentSizeBytes) {
      setMessage("Le document ne doit pas dépasser 20 Mo.");
      setTone("error");
      return;
    }
    setSelectedFile(file);
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
    if (!selectedFile) {
      setMessage("Choisissez d’abord une facture.");
      setTone("error");
      return;
    }

    setIsBusy(true);
    setMessage(
      "Votre facture est chiffrée, puis analysée par Lydoc. Cela peut prendre quelques instants.",
    );
    setTone("info");
    try {
      const uploadResponse = await fetch(`${apiUrl}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind: "ORANGE_INVOICE",
          originalName: selectedFile.name,
          mimeType: selectedFile.type,
          contentBase64: await fileToBase64(selectedFile),
        }),
      });
      const uploadPayload = await readJson(uploadResponse);
      const document = readDocument(uploadPayload.document);
      if (!uploadResponse.ok || !document)
        throw new Error(
          errorMessage(uploadPayload, "Le dépôt n’a pas abouti."),
        );

      setDocuments((current) => [
        document,
        ...current.filter((item) => item.id !== document.id),
      ]);
      await analyzeDocument(document.id);
      setSelectedFile(null);
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

  async function analyzeDocument(documentId: string) {
    setIsBusy(true);
    setMessage("Lecture de la facture et recherche des SMS surtaxés...");
    setTone("info");
    try {
      const response = await fetch(
        `${apiUrl}/documents/${documentId}/analyze`,
        { method: "POST", credentials: "include" },
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

  if (loading) return <LoadingState label="Chargement de vos documents..." />;

  return (
    <AppShell
      active="documents"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="page-container max-w-[1120px] py-9 sm:py-12">
        {view === "list" ? (
          <DocumentList
            documents={documents}
            isBusy={isBusy}
            message={message}
            tone={tone}
            onAnalyze={analyzeDocument}
            onUpload={openUpload}
          />
        ) : view === "upload" ? (
          <UploadView
            selectedFile={selectedFile}
            inputRef={inputRef}
            isBusy={isBusy}
            message={message}
            tone={tone}
            onBack={openList}
            onDrop={handleDrop}
            onFileChange={handleFileChange}
            onChoose={() => inputRef.current?.click()}
            onRemove={() => {
              setSelectedFile(null);
              setMessage("");
              if (inputRef.current) inputRef.current.value = "";
            }}
            onAnalyze={uploadAndAnalyze}
          />
        ) : analysis ? (
          <ResultView
            result={analysis}
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
  onUpload,
}: {
  documents: UploadedDocument[];
  isBusy: boolean;
  message: string;
  tone: NoticeTone;
  onAnalyze: (id: string) => Promise<void>;
  onUpload: () => void;
}) {
  return (
    <>
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-extrabold uppercase text-[#6f7b92]">
            Votre espace
          </p>
          <h1 className="mt-2 text-3xl font-extrabold text-[#101a34] sm:text-4xl">
            Mes documents
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#667189]">
            Vos factures et justificatifs, réunis au même endroit.
          </p>
        </div>
        <button
          type="button"
          onClick={onUpload}
          className="primary-button self-start sm:self-auto"
        >
          <Plus size={17} /> Nouvelle facture
        </button>
      </header>

      {message ? (
        <div className="mt-6">
          <Notice tone={tone} busy={isBusy}>
            {message}
          </Notice>
        </div>
      ) : null}

      <section className="surface mt-8 overflow-hidden">
        {documents.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <FileText className="mx-auto text-[#9aa5b8]" size={28} />
            <h2 className="mt-4 text-lg font-extrabold text-[#101a34]">
              Aucun document
            </h2>
            <p className="mt-2 text-sm text-[#667189]">
              Votre première facture apparaîtra ici après son analyse.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#e4e9f0]">
            {documents.map((document) => (
              <article
                key={document.id}
                className="grid gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_180px_130px_auto] sm:items-center sm:px-6"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#eef3ff] text-[#2457f5]">
                    <FileText size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-[#17213b]">
                      {document.originalName}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-[#7a8499]">
                      <LockKeyhole size={12} /> Chiffré ·{" "}
                      {formatBytes(document.sizeBytes)}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-semibold text-[#667189]">
                  {formatDocumentKind(document.kind)}
                </p>
                <div>
                  <StatusBadge status={document.status} />
                </div>
                <div className="sm:text-right">
                  {document.kind === "ORANGE_INVOICE" &&
                  document.status !== "ANALYZED" ? (
                    <button
                      type="button"
                      onClick={() => void onAnalyze(document.id)}
                      disabled={isBusy}
                      className="secondary-button min-h-9 px-3 text-xs"
                    >
                      {isBusy ? (
                        <LoaderCircle className="animate-spin" size={14} />
                      ) : (
                        <Sparkles size={14} />
                      )}{" "}
                      Analyser
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-[#16875b]">
                      Analyse terminée
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="mt-5 flex items-center justify-center gap-2 text-xs text-[#7a8499]">
        <LockKeyhole size={13} /> Tous vos fichiers sont stockés chiffrés.
      </p>
    </>
  );
}

function UploadView({
  selectedFile,
  inputRef,
  isBusy,
  message,
  tone,
  onBack,
  onDrop,
  onFileChange,
  onChoose,
  onRemove,
  onAnalyze,
}: {
  selectedFile: File | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isBusy: boolean;
  message: string;
  tone: NoticeTone;
  onBack: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onChoose: () => void;
  onRemove: () => void;
  onAnalyze: () => Promise<void>;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-[#667189] hover:text-[#2457f5]"
      >
        <ArrowLeft size={16} /> Retour aux documents
      </button>
      <header className="mt-7">
        <p className="text-xs font-extrabold uppercase text-[#6f7b92]">
          Nouvelle analyse
        </p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#101a34] sm:text-4xl">
          Analyser une facture
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#667189]">
          Importez votre facture opérateur. Lydoc recherche les SMS surtaxés
          éligibles au remboursement.
        </p>
      </header>

      {message ? (
        <div className="mt-6">
          <Notice tone={tone} busy={isBusy}>
            {message}
          </Notice>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        onChange={onFileChange}
        className="sr-only"
      />
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={onChoose}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onChoose();
        }}
        role="button"
        tabIndex={0}
        className="mt-8 flex min-h-[285px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-[#b9c7e5] bg-white px-6 text-center transition-colors hover:border-[#2457f5] hover:bg-[#fafbff]"
      >
        <UploadCloud size={40} strokeWidth={1.7} className="text-[#2457f5]" />
        <h2 className="mt-5 text-xl font-extrabold text-[#101a34]">
          Déposez votre facture
        </h2>
        <p className="mt-2 text-sm text-[#667189]">
          PDF, JPG ou PNG · 20 Mo maximum
        </p>
        <span className="primary-button mt-5 pointer-events-none">
          Choisir un fichier
        </span>
      </div>

      {selectedFile ? (
        <div className="mt-5 grid gap-4 rounded-md border border-[#d8e0eb] bg-white px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <FileText size={20} className="shrink-0 text-[#2457f5]" />
            <p className="truncate text-sm font-extrabold text-[#17213b]">
              {selectedFile.name}
            </p>
            <span className="shrink-0 text-sm text-[#667189]">
              {formatBytes(selectedFile.size)}
            </span>
          </div>
          <p className="flex items-center gap-2 text-sm font-bold text-[#16875b]">
            <CheckCircle2 size={17} /> Prête à être analysée
          </p>
          <button
            type="button"
            onClick={onRemove}
            disabled={isBusy}
            title="Retirer le fichier"
            aria-label="Retirer le fichier"
            className="grid h-9 w-9 place-items-center rounded-md text-[#667189] hover:bg-[#fff0ec] hover:text-[#b94a35]"
          >
            <Trash2 size={17} />
          </button>
        </div>
      ) : null}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => void onAnalyze()}
          disabled={!selectedFile || isBusy}
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

      <div className="mt-10 grid gap-4 border-t border-[#e3e8ef] pt-6 text-sm text-[#536078] sm:grid-cols-3">
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
  onBack,
  onAnother,
}: {
  result: AnalysisResult;
  onBack: () => void;
  onAnother: () => void;
}) {
  if (!result.eligible || !result.caseId) {
    return (
      <div className="mx-auto max-w-3xl py-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f1f4f8] text-[#667189]">
          <FileText size={22} />
        </span>
        <p className="mt-5 text-xs font-extrabold uppercase text-[#6f7b92]">
          Analyse terminée
        </p>
        <h1 className="mt-3 text-3xl font-extrabold text-[#101a34]">
          Aucun SMS remboursable identifié
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#667189]">
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
        className="inline-flex items-center gap-2 text-sm font-bold text-[#667189] hover:text-[#2457f5]"
      >
        <ArrowLeft size={16} /> Retour aux documents
      </button>
      <div className="mx-auto mt-7 max-w-[940px] text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[#b7ddca] text-[#16875b]">
          <Check size={22} strokeWidth={2.5} />
        </span>
        <p className="mt-5 text-xs font-extrabold uppercase text-[#16875b]">
          Analyse terminée
        </p>
        <h1 className="mt-3 text-3xl font-extrabold text-[#101a34] sm:text-4xl">
          Bonne nouvelle, {formatCents(result.amountCents)} sont remboursables
        </h1>
        <p className="mt-4 text-base text-[#667189]">
          Nous avons identifié {result.smsCount} SMS surtaxé
          {result.smsCount > 1 ? "s" : ""} lié{result.smsCount > 1 ? "s" : ""} à{" "}
          {result.ruleName}.
        </p>

        <div className="mx-auto mt-8 max-w-[760px]">
          <JourneySteps current={1} />
        </div>

        <section className="surface mt-8 grid overflow-hidden text-left md:grid-cols-2 md:divide-x md:divide-[#e2e7ee]">
          <div className="p-6 sm:p-8">
            <p className="text-sm font-extrabold text-[#17213b]">
              Remboursement détecté
            </p>
            <p className="mt-4 text-4xl font-extrabold text-[#101a34]">
              {formatCents(result.amountCents)}
            </p>
            <p className="mt-3 text-sm text-[#667189]">
              {result.smsCount} SMS surtaxé{result.smsCount > 1 ? "s" : ""}
            </p>
          </div>
          <div className="border-t border-[#e2e7ee] p-6 sm:p-8 md:border-t-0">
            <p className="text-sm font-extrabold text-[#17213b]">
              Règlement correspondant
            </p>
            <p className="mt-4 text-lg font-extrabold text-[#101a34]">
              {result.ruleName}
            </p>
            <p className="mt-3 flex items-center gap-2 text-sm font-bold text-[#16875b]">
              <CheckCircle2 size={17} /> Éligible
            </p>
          </div>
        </section>

        <h2 className="mt-9 text-xl font-extrabold text-[#101a34]">
          Souhaitez-vous constituer votre dossier ?
        </h2>
        <p className="mt-3 text-sm text-[#667189]">
          Lydoc vous guidera uniquement vers les pièces demandées par le
          règlement.
        </p>
        <a
          href={`/cases/${result.caseId}`}
          className="primary-button mt-6 min-w-[230px]"
        >
          Commencer mon dossier <ArrowRight size={17} />
        </a>
        <button
          type="button"
          onClick={onBack}
          className="mx-auto mt-4 block text-sm font-bold text-[#667189] hover:text-[#2457f5]"
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
      <span className="text-[#2457f5]">{icon}</span>
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
  };
}
