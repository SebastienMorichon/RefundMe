"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Download,
  Eye,
  FileCheck2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "../../../components/app-shell";

type RequiredDocument = { kind: string; label: string; required: boolean; supplied: boolean };
type CaseDetail = {
  id: string;
  status: string;
  estimatedRecoverableCents: number;
  serviceFeeCents: number;
  rule: { id: string; version: number; name: string; organizer: string };
  requiredDocuments: RequiredDocument[];
  missingDocuments: RequiredDocument[];
  customerProfile: { complete: boolean; missingFields: string[] };
  payment: { status: string; paidAt: string | null } | null;
  validation: { validatedAt: string } | null;
  review: {
    reimbursementRecipient: string;
    reimbursementAddress: string;
    reimbursementDeadline: string;
    detectedSmsCount: number;
  };
  postalShipment: {
    provider: string;
    environment: string;
    product: string;
    status: string;
    postageCents: number;
    providerServiceCents: number;
    totalCents: number;
    trackingNumber: string | null;
    errorMessage: string | null;
    quotedAt: string | null;
    submittedAt: string | null;
    deliveredAt: string | null;
    simulation: boolean;
  } | null;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maxDocumentSizeBytes = 20 * 1024 * 1024;

export default function CasePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const caseId = params.id;
  const [administrativeCase, setAdministrativeCase] = useState<CaseDetail | null>(null);
  const [message, setMessage] = useState("Chargement du dossier...");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [isBusy, setIsBusy] = useState(false);
  const [confirmationAccepted, setConfirmationAccepted] = useState(false);
  const [postalAccepted, setPostalAccepted] = useState(false);

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;

    async function refreshAfterCheckout() {
      const returnedFromPayment = new URLSearchParams(window.location.search).get("payment") === "success";
      const attempts = returnedFromPayment ? 5 : 1;
      if (returnedFromPayment) {
        setMessage("Paiement reçu. Nous finalisons votre dossier...");
      }
      for (let attempt = 0; attempt < attempts && !cancelled; attempt += 1) {
        const loaded = await loadCase();
        if (loaded?.payment?.status === "PAID" || !returnedFromPayment) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    }

    void refreshAfterCheckout();
    return () => { cancelled = true; };
  }, [caseId]);

  async function loadCase(): Promise<CaseDetail | null> {
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}`, { credentials: "include" });
      const payload = await readJson(response);
      const parsedCase = readCase(payload.case);
      if (!response.ok || !parsedCase) throw new Error(errorMessage(payload, "Dossier introuvable."));
      setAdministrativeCase(parsedCase);
      if (parsedCase.payment?.status === "PAID") {
        setMessage("Paiement confirmé. Votre dossier final est prêt à être téléchargé.");
        setMessageTone("success");
      } else if (parsedCase.status === "READY_TO_PAY") {
        setMessage(parsedCase.validation
          ? "Votre récapitulatif est validé. Vous pouvez consulter l’aperçu puis payer."
          : "Votre dossier est complet. Vérifiez et validez le récapitulatif avant le paiement.");
        setMessageTone("success");
      } else if (parsedCase.status === "DRAFT") {
        setMessage("Le règlement a été identifié. Lancez la préparation pour voir les pièces utiles.");
        setMessageTone("info");
      } else {
        setMessage("Ajoutez uniquement les pièces encore demandées.");
        setMessageTone("info");
      }
      return parsedCase;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dossier introuvable.");
      setMessageTone("error");
      return null;
    }
  }

  async function startCase() {
    await sendCaseAction("start", "Préparation de la liste des pièces...");
  }

  async function attachDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const kind = String(formData.get("kind") ?? "");
    const file = formData.get("document") as File | null;
    if (!file || !kind) {
      setMessage("Choisissez la pièce demandée et le fichier correspondant.");
      setMessageTone("error");
      return;
    }
    if (file.size > maxDocumentSizeBytes || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setMessage("Utilisez un PDF, JPG ou PNG de 20 Mo maximum.");
      setMessageTone("error");
      return;
    }

    setIsBusy(true);
    setMessage("Dépôt sécurisé de la pièce...");
    setMessageTone("info");
    try {
      const uploadResponse = await fetch(`${apiUrl}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          kind,
          originalName: file.name,
          mimeType: file.type,
          contentBase64: await fileToBase64(file),
        }),
      });
      const uploadPayload = await readJson(uploadResponse);
      const documentId = readDocumentId(uploadPayload.document);
      if (!uploadResponse.ok || !documentId) {
        throw new Error(errorMessage(uploadPayload, "Impossible de déposer la pièce."));
      }
      const attachResponse = await fetch(`${apiUrl}/cases/${caseId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ documentId }),
      });
      const attachPayload = await readJson(attachResponse);
      const parsedCase = readCase(attachPayload.case);
      if (!attachResponse.ok || !parsedCase) {
        throw new Error(errorMessage(attachPayload, "Impossible de rattacher la pièce au dossier."));
      }
      setAdministrativeCase(parsedCase);
      form.reset();
      setMessage(parsedCase.status === "READY_TO_PAY"
        ? "Toutes les pièces sont réunies. Votre dossier est complet."
        : "La pièce a bien été ajoutée. Il en reste encore à fournir.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Le dépôt n’a pas abouti.");
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function sendCaseAction(action: string, progressMessage: string) {
    setIsBusy(true);
    setMessage(progressMessage);
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/${action}`, { method: "POST", credentials: "include" });
      const payload = await readJson(response);
      const parsedCase = readCase(payload.case);
      if (!response.ok || !parsedCase) throw new Error(errorMessage(payload, "Action impossible."));
      setAdministrativeCase(parsedCase);
      setMessage("La préparation a commencé. Ajoutez les pièces indiquées ci-dessous.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action impossible.");
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function openPacket() {
    setIsBusy(true);
    setMessage(administrativeCase?.payment?.status === "PAID" ? "Génération du dossier final..." : "Génération de l’aperçu...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/dossier.pdf`, { credentials: "include" });
      if (!response.ok) {
        const payload = await readJson(response);
        throw new Error(errorMessage(payload, "Impossible de générer le dossier."));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      if (administrativeCase?.payment?.status === "PAID") link.download = `dossier-lydoc-${caseId}.pdf`;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(administrativeCase?.payment?.status === "PAID" ? "Votre dossier final a été généré." : "L’aperçu est prêt.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible de générer le dossier.");
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function startCheckout() {
    setIsBusy(true);
    setMessage("Ouverture du paiement sécurisé...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/checkout-session`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(errorMessage(payload, "Impossible d’ouvrir le paiement."));
      }
      window.location.assign(payload.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible d’ouvrir le paiement.");
      setMessageTone("error");
      setIsBusy(false);
    }
  }

  async function confirmCase() {
    if (!confirmationAccepted) {
      setMessage("Confirmez que les informations du récapitulatif sont exactes.");
      setMessageTone("error");
      return;
    }
    setIsBusy(true);
    setMessage("Validation du récapitulatif...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/confirm`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);
      const parsedCase = readCase(payload.case);
      if (!response.ok || !parsedCase) {
        throw new Error(errorMessage(payload, "Impossible de valider le dossier."));
      }
      setAdministrativeCase(parsedCase);
      setConfirmationAccepted(false);
      setMessage("Récapitulatif validé. Les informations du dossier sont maintenant figées.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible de valider le dossier.");
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function preparePostalQuote() {
    if (!postalAccepted) {
      setMessage("Autorisez la préparation de l’envoi postal pour obtenir le devis.");
      setMessageTone("error");
      return;
    }
    setIsBusy(true);
    setMessage("Préparation du dossier pour l’impression et calcul des frais postaux...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/postal-quote`, { method: "POST", credentials: "include" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, "Impossible de calculer les frais postaux."));
      const loaded = await loadCase();
      if (!loaded?.postalShipment) throw new Error("Le devis postal n’a pas été enregistré.");
      setPostalAccepted(false);
      setMessage(loaded.postalShipment.simulation ? "Devis postal simulé. Aucun courrier réel ne sera envoyé." : "Devis postal prêt. L’envoi sera déclenché après le paiement.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible de préparer l’envoi postal.");
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshPostalTracking() {
    setIsBusy(true);
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/postal-shipment/refresh`, { method: "POST", credentials: "include" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, "Impossible d’actualiser le suivi."));
      await loadCase();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible d’actualiser le suivi.");
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteCase() {
    if (!window.confirm("Supprimer ce dossier ? Les documents déposés resteront dans votre espace.")) {
      return;
    }

    setIsBusy(true);
    setMessage("Suppression du dossier...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok || payload.deleted !== true) {
        throw new Error(errorMessage(payload, "Impossible de supprimer le dossier."));
      }
      router.push("/dashboard#dossiers");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible de supprimer le dossier.");
      setMessageTone("error");
      setIsBusy(false);
    }
  }

  const missingDocuments = administrativeCase?.missingDocuments ?? [];
  const progress = progressIndex(administrativeCase?.status ?? "DRAFT");
  const isPaid = administrativeCase?.payment?.status === "PAID";

  return (
    <AppShell active="cases">
      <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <a href="/dashboard#dossiers" className="inline-flex items-center gap-2 text-sm font-bold text-[#667189] hover:text-[#2457f5]">
          <ArrowLeft size={16} /> Retour aux dossiers
        </a>
        <div className="mt-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase text-[#7a8499]">Dossier de remboursement</p>
            <h1 className="mt-2 text-2xl font-extrabold text-[#102544] sm:text-3xl">{administrativeCase?.rule.name ?? "Chargement..."}</h1>
            <p className="mt-2 text-sm text-[#667189]">{administrativeCase?.rule.organizer ?? ""}</p>
          </div>
          {administrativeCase ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={deleteCase}
                disabled={isBusy}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#f1b9ac] bg-white px-3 text-xs font-extrabold text-[#b94a35] hover:bg-[#fff0ec] disabled:opacity-50"
              >
                <Trash2 size={15} /> Supprimer le dossier
              </button>
              <StatusBadge status={administrativeCase.status} paid={isPaid} />
            </div>
          ) : null}
        </div>

        <div className={`mt-6 flex items-start gap-3 border-l-4 p-4 text-sm leading-6 ${messageTone === "success" ? "border-[#16875b] bg-[#e8f7f0] text-[#326950]" : messageTone === "error" ? "border-[#e9654b] bg-[#fff0ec] text-[#8e3d2c]" : "border-[#2457f5] bg-[#eef3ff] text-[#344f8d]"}`} role="status">
          {messageTone === "success" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : messageTone === "error" ? <ShieldCheck size={18} className="mt-0.5 shrink-0" /> : isBusy ? <LoaderCircle size={18} className="mt-0.5 shrink-0 animate-spin" /> : <ReceiptText size={18} className="mt-0.5 shrink-0" />}
          {message}
        </div>

        {administrativeCase ? (
          <>
            <section className="surface mt-6 overflow-hidden">
              <div className="grid divide-y divide-[#dce3ed] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Metric label="Montant estimé" value={formatCents(administrativeCase.estimatedRecoverableCents)} />
                <Metric label="Frais de service" value={formatCents(administrativeCase.serviceFeeCents)} />
                <Metric label="Gain potentiel net" value={formatCents(Math.max(0, administrativeCase.estimatedRecoverableCents - administrativeCase.serviceFeeCents))} positive />
              </div>
              <div className="border-t border-[#dce3ed] bg-[#f8fafc] px-5 py-5 sm:px-6">
                <ol className="grid gap-4 sm:grid-cols-4">
                  {["Règlement identifié", "Pièces réunies", "Validation", "Envoi"].map((label, index) => (
                    <li key={label} className="flex items-center gap-3">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-extrabold ${index < progress ? "bg-[#16875b] text-white" : index === progress ? "bg-[#2457f5] text-white" : "bg-[#e1e7ef] text-[#7a8499]"}`}>
                        {index < progress ? <Check size={14} strokeWidth={3} /> : index + 1}
                      </span>
                      <span className={`text-xs font-bold ${index <= progress ? "text-[#34415d]" : "text-[#8b95a8]"}`}>{label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            <section className="mt-6 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="surface p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div><h2 className="text-lg font-extrabold text-[#102544]">Pièces du dossier</h2><p className="mt-1 text-sm text-[#667189]">Demandées uniquement par le règlement applicable.</p></div>
                  <span className="text-xs font-extrabold text-[#7a8499]">{administrativeCase.requiredDocuments.length - missingDocuments.length}/{administrativeCase.requiredDocuments.length}</span>
                </div>
                {administrativeCase.requiredDocuments.length ? (
                  <div className="mt-5 divide-y divide-[#e2e8f0] border-y border-[#e2e8f0]">
                    {administrativeCase.requiredDocuments.map((item) => (
                      <div key={item.kind} className="flex items-center gap-4 py-4">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${item.supplied ? "bg-[#e8f7f0] text-[#16875b]" : "bg-[#fff4e7] text-[#a95d12]"}`}>{item.supplied ? <FileCheck2 size={19} /> : <FileText size={19} />}</span>
                        <div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-[#34415d]">{item.label}</p><p className="mt-1 text-xs text-[#7a8499]">{item.supplied ? "Ajoutée au dossier" : "Encore nécessaire"}</p></div>
                        <span className={`text-xs font-extrabold ${item.supplied ? "text-[#16875b]" : "text-[#a95d12]"}`}>{item.supplied ? "Fourni" : "Manquant"}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-6 text-sm text-[#667189]">Lancez la préparation pour obtenir la liste exacte.</p>}
              </div>

              <div>
                {administrativeCase.status === "DRAFT" ? (
                  <section className="surface p-5 sm:p-6">
                    <span className="grid h-11 w-11 place-items-center rounded-md bg-[#e8efff] text-[#2457f5]"><ReceiptText size={21} /></span>
                    <h2 className="mt-5 text-lg font-extrabold text-[#102544]">Prêt à préparer ce dossier ?</h2>
                    <p className="mt-3 text-sm leading-6 text-[#667189]">Lydoc va lire les exigences du règlement et afficher uniquement les justificatifs nécessaires.</p>
                    <button disabled={isBusy} onClick={startCase} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:opacity-50">Préparer mon dossier <ChevronRight size={17} /></button>
                  </section>
                ) : null}

                {administrativeCase.status !== "DRAFT" && missingDocuments.length > 0 ? (
                  <form onSubmit={attachDocument} className="surface p-5 sm:p-6">
                    <span className="grid h-11 w-11 place-items-center rounded-md bg-[#e8efff] text-[#2457f5]"><UploadCloud size={21} /></span>
                    <h2 className="mt-5 text-lg font-extrabold text-[#102544]">Ajouter une pièce</h2>
                    <p className="mt-2 text-sm leading-6 text-[#667189]">Choisissez le type demandé puis le fichier correspondant.</p>
                    <label className="mt-5 grid gap-2 text-sm font-bold text-[#26334f]">Pièce demandée<select name="kind" className="field">{missingDocuments.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select></label>
                    <label className="mt-4 grid gap-2 text-sm font-bold text-[#26334f]">Fichier<input name="document" type="file" accept="application/pdf,image/png,image/jpeg" className="field file:mr-3 file:rounded-md file:border-0 file:bg-[#e8efff] file:px-3 file:py-1 file:text-xs file:font-extrabold file:text-[#2457f5]" /></label>
                    <p className="mt-3 flex items-center gap-2 text-xs text-[#667189]"><LockKeyhole size={14} className="text-[#16875b]" />PDF, JPG ou PNG · 20 Mo maximum</p>
                    <button disabled={isBusy} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:opacity-50">{isBusy ? <LoaderCircle size={17} className="animate-spin" /> : <UploadCloud size={17} />} Ajouter au dossier</button>
                  </form>
                ) : null}

                {administrativeCase.status === "READY_TO_PAY" || isPaid ? (
                  <section className="surface border-t-4 border-t-[#16875b] p-5 sm:p-6">
                    <span className="grid h-11 w-11 place-items-center rounded-md bg-[#e8f7f0] text-[#16875b]">{isPaid ? <Download size={21} /> : <CheckCircle2 size={22} />}</span>
                    <h2 className="mt-5 text-lg font-extrabold text-[#102544]">{isPaid ? "Votre dossier final est prêt." : "Votre dossier est complet."}</h2>
                    <p className="mt-3 text-sm leading-6 text-[#667189]">Vérifiez les informations qui seront utilisées dans la demande de remboursement.</p>
                    {!administrativeCase.customerProfile.complete ? (
                      <div className="mt-5 border-l-4 border-[#d47a22] bg-[#fff4e7] p-4 text-sm leading-6 text-[#7d4c13]">
                        <p className="font-extrabold">Informations personnelles à compléter</p>
                        <p className="mt-1">{administrativeCase.customerProfile.missingFields.join(", ")}</p>
                        <a href="/profile" className="mt-3 inline-flex font-extrabold text-[#2457f5]">Compléter mon profil</a>
                      </div>
                    ) : null}
                    <dl className="mt-5 divide-y divide-[#e2e8f0] border-y border-[#e2e8f0] text-sm">
                      <ReviewLine label="Jeu" value={`${administrativeCase.rule.name} · règlement v${administrativeCase.rule.version}`} />
                      <ReviewLine label="Destinataire" value={administrativeCase.review.reimbursementRecipient} />
                      {administrativeCase.review.reimbursementAddress ? <ReviewLine label="Adresse d’envoi" value={administrativeCase.review.reimbursementAddress} /> : null}
                      {administrativeCase.review.reimbursementDeadline ? <ReviewLine label="Délai" value={administrativeCase.review.reimbursementDeadline} /> : null}
                      <ReviewLine label="SMS détectés" value={String(administrativeCase.review.detectedSmsCount)} />
                      <ReviewLine label="Montant demandé" value={formatCents(administrativeCase.estimatedRecoverableCents)} />
                      <ReviewLine label="Frais de préparation" value={formatCents(administrativeCase.serviceFeeCents)} strong />
                      {administrativeCase.postalShipment ? <ReviewLine label="Impression et affranchissement" value={formatCents(administrativeCase.postalShipment.totalCents)} strong /> : null}
                    </dl>
                    {administrativeCase.validation ? (
                      <p className="mt-4 flex items-center gap-2 text-xs font-bold text-[#16875b]"><ShieldCheck size={16} /> Informations figées le {formatDateTime(administrativeCase.validation.validatedAt)}</p>
                    ) : (
                      <>
                        <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6 text-[#34415d]">
                          <input type="checkbox" checked={confirmationAccepted} onChange={(event) => setConfirmationAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-[#2457f5]" />
                          <span>Je confirme que mes coordonnées, les pièces et les informations ci-dessus sont exactes.</span>
                        </label>
                        <button type="button" onClick={confirmCase} disabled={isBusy || !confirmationAccepted || !administrativeCase.customerProfile.complete} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:opacity-50"><ShieldCheck size={17} /> Valider mes informations</button>
                      </>
                    )}
                    {administrativeCase.validation && !administrativeCase.postalShipment ? (
                      <div className="mt-5 border-l-4 border-[#2457f5] bg-[#eef3ff] p-4">
                        <p className="text-sm font-extrabold text-[#102544]">Préparer l’envoi postal</p>
                        <p className="mt-2 text-xs leading-5 text-[#536078]">Le dossier complet sera transmis au prestataire d’impression afin de calculer son prix. Aucun envoi n’est validé avant le paiement.</p>
                        <label className="mt-3 flex cursor-pointer items-start gap-3 text-xs leading-5 text-[#34415d]"><input type="checkbox" checked={postalAccepted} onChange={(event) => setPostalAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-[#2457f5]" /><span>J’autorise la préparation de mon dossier pour son impression et son expédition postale.</span></label>
                        <button type="button" onClick={preparePostalQuote} disabled={isBusy || !postalAccepted} className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-4 text-xs font-extrabold text-white disabled:opacity-50"><ReceiptText size={16} /> Calculer les frais postaux</button>
                      </div>
                    ) : null}
                    {administrativeCase.postalShipment ? (
                      <div className="mt-5 bg-[#f8fafc] p-4 text-sm">
                        <div className="flex items-center justify-between gap-3"><span className="font-bold text-[#536078]">Envoi</span><span className="font-extrabold text-[#102544]">{formatPostalStatus(administrativeCase.postalShipment.status)}</span></div>
                        <p className="mt-2 text-xs text-[#667189]">{administrativeCase.postalShipment.product === "vertesuivi" ? "Lettre verte suivie" : "Lettre verte"}{administrativeCase.postalShipment.simulation ? " · simulation" : ""}</p>
                        {administrativeCase.postalShipment.trackingNumber ? <p className="mt-2 text-xs font-bold text-[#34415d]">Suivi : {administrativeCase.postalShipment.trackingNumber}</p> : null}
                        {administrativeCase.postalShipment.errorMessage ? <p className="mt-2 text-xs font-bold text-[#b94a35]">{administrativeCase.postalShipment.errorMessage}</p> : null}
                        {["SUBMITTED", "PRODUCED", "HANDED_OVER", "IN_TRANSIT"].includes(administrativeCase.postalShipment.status) ? <button type="button" onClick={refreshPostalTracking} disabled={isBusy} className="mt-3 text-xs font-extrabold text-[#2457f5]">Actualiser le suivi</button> : null}
                      </div>
                    ) : null}
                    <button type="button" onClick={openPacket} disabled={isBusy || !administrativeCase.validation} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[#b9c8df] bg-white px-5 text-sm font-extrabold text-[#2457f5] hover:bg-[#f4f7ff] disabled:opacity-50">{isPaid ? <Download size={17} /> : <Eye size={17} />} {isPaid ? "Télécharger le dossier final" : "Voir l’aperçu du dossier"}</button>
                    {!isPaid ? <button type="button" onClick={startCheckout} disabled={isBusy || !administrativeCase.customerProfile.complete || !administrativeCase.validation || administrativeCase.postalShipment?.status !== "QUOTED"} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:opacity-50"><CircleDollarSign size={17} /> Payer {formatCents(administrativeCase.serviceFeeCents + (administrativeCase.postalShipment?.totalCents ?? 0))}</button> : null}
                  </section>
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

function Metric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return <div className="p-5 sm:p-6"><p className="text-xs font-bold text-[#7a8499]">{label}</p><p className={`mt-2 text-2xl font-extrabold ${positive ? "text-[#16875b]" : "text-[#102544]"}`}>{value}</p></div>;
}

function ReviewLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="grid gap-1 py-3 sm:grid-cols-[145px_1fr]"><dt className="font-bold text-[#7a8499]">{label}</dt><dd className={strong ? "font-extrabold text-[#102544]" : "font-semibold text-[#34415d]"}>{value || "Non renseigné"}</dd></div>;
}

function StatusBadge({ status, paid }: { status: string; paid: boolean }) {
  const success = paid || ["READY_TO_PAY", "SENT", "REFUNDED"].includes(status);
  return <span className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-extrabold ${success ? "bg-[#e8f7f0] text-[#16875b]" : "bg-[#fff4e7] text-[#a95d12]"}`}><span className={`status-dot ${success ? "bg-[#16875b]" : "bg-[#d47a22]"}`} />{paid ? "Payé" : formatStatus(status)}</span>;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result.slice(reader.result.indexOf(",") + 1)) : reject(new Error("Lecture impossible."));
    reader.onerror = () => reject(new Error("Lecture impossible."));
    reader.readAsDataURL(file);
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.message === "string" ? payload.message : fallback;
}

function readDocumentId(value: unknown): string | null {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string"
    ? (value as Record<string, unknown>).id as string
    : null;
}

function readCase(value: unknown): CaseDetail | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rule = item.rule as Record<string, unknown> | undefined;
  const customerProfile = item.customerProfile as Record<string, unknown> | undefined;
  const review = item.review as Record<string, unknown> | undefined;
  if (typeof item.id !== "string" || typeof item.status !== "string" || typeof item.estimatedRecoverableCents !== "number" || typeof item.serviceFeeCents !== "number" || !rule || typeof rule.id !== "string" || typeof rule.version !== "number" || typeof rule.name !== "string" || typeof rule.organizer !== "string" || !Array.isArray(item.requiredDocuments) || !Array.isArray(item.missingDocuments) || !customerProfile || typeof customerProfile.complete !== "boolean" || !Array.isArray(customerProfile.missingFields) || !review || typeof review.reimbursementRecipient !== "string" || typeof review.reimbursementAddress !== "string" || typeof review.reimbursementDeadline !== "string" || typeof review.detectedSmsCount !== "number") return null;
  const parseDocument = (raw: unknown): RequiredDocument | null => {
    if (!raw || typeof raw !== "object") return null;
    const document = raw as Record<string, unknown>;
    return typeof document.kind === "string" && typeof document.label === "string" && typeof document.required === "boolean" && typeof document.supplied === "boolean"
      ? { kind: document.kind, label: document.label, required: document.required, supplied: document.supplied }
      : null;
  };
  const payment = item.payment && typeof item.payment === "object" ? item.payment as Record<string, unknown> : null;
  const validation = item.validation && typeof item.validation === "object" ? item.validation as Record<string, unknown> : null;
  const postalShipment = item.postalShipment && typeof item.postalShipment === "object" ? item.postalShipment as Record<string, unknown> : null;
  return {
    id: item.id,
    status: item.status,
    estimatedRecoverableCents: item.estimatedRecoverableCents,
    serviceFeeCents: item.serviceFeeCents,
    rule: { id: rule.id, version: rule.version, name: rule.name, organizer: rule.organizer },
    requiredDocuments: item.requiredDocuments.flatMap((raw) => { const parsed = parseDocument(raw); return parsed ? [parsed] : []; }),
    missingDocuments: item.missingDocuments.flatMap((raw) => { const parsed = parseDocument(raw); return parsed ? [parsed] : []; }),
    customerProfile: {
      complete: customerProfile.complete,
      missingFields: customerProfile.missingFields.filter((field): field is string => typeof field === "string"),
    },
    payment: payment && typeof payment.status === "string"
      ? { status: payment.status, paidAt: typeof payment.paidAt === "string" ? payment.paidAt : null }
      : null,
    validation: validation && typeof validation.validatedAt === "string"
      ? { validatedAt: validation.validatedAt }
      : null,
    review: {
      reimbursementRecipient: review.reimbursementRecipient,
      reimbursementAddress: review.reimbursementAddress,
      reimbursementDeadline: review.reimbursementDeadline,
      detectedSmsCount: review.detectedSmsCount,
    },
    postalShipment: readPostalShipment(postalShipment),
  };
}

function readPostalShipment(value: Record<string, unknown> | null): CaseDetail["postalShipment"] {
  if (!value) return null;
  if (
    typeof value.provider !== "string" || typeof value.environment !== "string" || typeof value.product !== "string" ||
    typeof value.status !== "string" || typeof value.postageCents !== "number" ||
    typeof value.providerServiceCents !== "number" || typeof value.totalCents !== "number" || typeof value.simulation !== "boolean"
  ) return null;
  return {
    provider: value.provider,
    environment: value.environment,
    product: value.product,
    status: value.status,
    postageCents: value.postageCents,
    providerServiceCents: value.providerServiceCents,
    totalCents: value.totalCents,
    trackingNumber: typeof value.trackingNumber === "string" ? value.trackingNumber : null,
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
    quotedAt: typeof value.quotedAt === "string" ? value.quotedAt : null,
    submittedAt: typeof value.submittedAt === "string" ? value.submittedAt : null,
    deliveredAt: typeof value.deliveredAt === "string" ? value.deliveredAt : null,
    simulation: value.simulation,
  };
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = { DRAFT: "À préparer", WAITING_FOR_USER_DOCUMENTS: "Pièces attendues", READY_TO_PAY: "Dossier complet", PAID: "Payé", SENT: "Envoyé", REFUNDED: "Remboursé", REJECTED: "Refusé" };
  return labels[status] ?? status;
}

function formatPostalStatus(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Brouillon",
    QUOTED: "Devis prêt",
    SUBMITTED: "Transmis à l’imprimeur",
    PRODUCED: "Imprimé et mis sous pli",
    HANDED_OVER: "Remis à La Poste",
    IN_TRANSIT: "En cours d’acheminement",
    DELIVERED: "Distribué",
    FAILED: "Action requise",
    CANCELLED: "Annulé",
  };
  return labels[status] ?? status;
}

function progressIndex(status: string): number {
  if (["REFUNDED", "SENT", "PAID", "GENERATED", "PRINT_READY"].includes(status)) return 3;
  if (status === "READY_TO_PAY") return 2;
  if (status === "WAITING_FOR_USER_DOCUMENTS") return 1;
  return 0;
}
