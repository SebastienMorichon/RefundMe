"use client";

import { ArrowLeft, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { DetectionReviewCard } from "../../../components/detection-review-card";
import { apiFetch as fetch } from "../../../lib/api-client";
import {
  ChoiceView,
  DocumentsView,
  ManagedPostalUnavailableView,
  PostalConsentView,
  PostalQuoteView,
  ReviewView,
  SelfServiceView,
  StartView,
  TrackingView,
} from "../../../components/case-workflow-views";
import {
  JourneySteps,
  LoadingState,
  Notice,
  StatusBadge,
  type NoticeTone,
} from "../../../components/client-ui";
import {
  apiUrl,
  errorMessage,
  formatCents,
  readDocument,
  readJson,
  readUser,
  type User,
} from "../../../lib/client-data";
import {
  caseNotice,
  journeyStep,
  readCaseDetail,
  type CaseDetail,
  type FulfillmentMode,
} from "../../../lib/case-detail";
import { managedPostalEnabled } from "../../../lib/feature-flags";

const maxDocumentSizeBytes = 20 * 1024 * 1024;
const allowedDocumentTypes = ["application/pdf", "image/png", "image/jpeg"];

export default function CasePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const caseId = params.id;
  const [user, setUser] = useState<User | null>(null);
  const [administrativeCase, setAdministrativeCase] =
    useState<CaseDetail | null>(null);
  const [message, setMessage] = useState("Chargement du dossier...");
  const [messageTone, setMessageTone] = useState<NoticeTone>("info");
  const [isBusy, setIsBusy] = useState(false);
  const [confirmationAccepted, setConfirmationAccepted] = useState(false);
  const [postalAccepted, setPostalAccepted] = useState(false);
  const [fulfillmentSelection, setFulfillmentSelection] =
    useState<FulfillmentMode | null>(null);

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;

    async function initialize() {
      void loadUser();
      const returnedFromPayment =
        new URLSearchParams(window.location.search).get("payment") ===
        "success";
      const attempts = returnedFromPayment ? 5 : 1;
      if (returnedFromPayment) {
        setMessage("Paiement reçu. Nous finalisons votre prise en charge...");
        setMessageTone("info");
      }
      for (let attempt = 0; attempt < attempts && !cancelled; attempt += 1) {
        const loaded = await loadCase();
        if (loaded?.payment?.status === "PAID" || !returnedFromPayment) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  async function loadUser() {
    try {
      const response = await fetch(`${apiUrl}/auth/me`, {
        credentials: "include",
      });
      if (response.status === 401 || response.status === 404) {
        router.replace("/connexion");
        return;
      }
      const payload = await readJson(response);
      const sessionUser = readUser(payload.user);
      if (response.ok && sessionUser) setUser(sessionUser);
    } catch {
      // The case request below displays the actionable connection error.
    }
  }

  async function loadCase(): Promise<CaseDetail | null> {
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}`, {
        credentials: "include",
      });
      if (response.status === 401) {
        router.replace("/connexion");
        return null;
      }
      const payload = await readJson(response);
      const parsedCase = readCaseDetail(payload.case);
      if (!response.ok || !parsedCase)
        throw new Error(errorMessage(payload, "Dossier introuvable."));
      setAdministrativeCase(parsedCase);
      setFulfillmentSelection(parsedCase.fulfillmentMode);
      const state = caseNotice(parsedCase, managedPostalEnabled);
      setMessage(state.message);
      setMessageTone(state.tone);
      return parsedCase;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Dossier introuvable.",
      );
      setMessageTone("error");
      return null;
    }
  }

  async function startCase() {
    await sendCaseAction("start", "Lecture des exigences du règlement...");
  }

  async function updateDetection(smsCount: number, amountCents: number) {
    setIsBusy(true);
    setMessage("Enregistrement de votre vérification...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/detection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ smsCount, amountCents }),
      });
      const payload = await readJson(response);
      const parsedCase = readCaseDetail(payload.case);
      if (!response.ok || !parsedCase) {
        throw new Error(
          errorMessage(payload, "Impossible d’enregistrer la correction."),
        );
      }
      setAdministrativeCase(parsedCase);
      setConfirmationAccepted(false);
      setMessage("Le nombre de SMS et le montant ont été enregistrés.");
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible d’enregistrer la correction.",
      );
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function updatePostalExpenseClaim(requested: boolean) {
    setIsBusy(true);
    setMessage(
      requested
        ? "Ajout des frais postaux et d'impression à votre demande..."
        : "Retrait des frais postaux et d'impression...",
    );
    setMessageTone("info");
    try {
      const response = await fetch(
        `${apiUrl}/cases/${caseId}/postal-expense-claim`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ requested }),
        },
      );
      const payload = await readJson(response);
      const parsedCase = readCaseDetail(payload.case);
      if (!response.ok || !parsedCase) {
        throw new Error(
          errorMessage(payload, "Impossible d'enregistrer votre choix."),
        );
      }
      setAdministrativeCase(parsedCase);
      setConfirmationAccepted(false);
      setMessage(
        requested
          ? "La lettre demandera aussi le remboursement des frais autorisés par le règlement."
          : "La demande de remboursement des frais annexes a été retirée.",
      );
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible d'enregistrer votre choix.",
      );
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
      const response = await fetch(`${apiUrl}/cases/${caseId}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);
      const parsedCase = readCaseDetail(payload.case);
      if (!response.ok || !parsedCase)
        throw new Error(errorMessage(payload, "Action impossible."));
      setAdministrativeCase(parsedCase);
      const state = caseNotice(parsedCase, managedPostalEnabled);
      setMessage(state.message);
      setMessageTone(state.tone);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action impossible.");
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function attachDocument(kind: string, file: File | undefined) {
    if (!file) return;
    if (
      file.size > maxDocumentSizeBytes ||
      !allowedDocumentTypes.includes(file.type)
    ) {
      setMessage("Utilisez un PDF, JPG ou PNG de 20 Mo maximum.");
      setMessageTone("error");
      return;
    }

    setIsBusy(true);
    setMessage("Ajout sécurisé de la pièce au dossier...");
    setMessageTone("info");
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file, file.name);
      const uploadResponse = await fetch(`${apiUrl}/documents`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const uploadPayload = await readJson(uploadResponse);
      const uploadedDocument = readDocument(uploadPayload.document);
      if (!uploadResponse.ok || !uploadedDocument)
        throw new Error(
          errorMessage(uploadPayload, "Impossible de déposer la pièce."),
        );

      const attachResponse = await fetch(
        `${apiUrl}/cases/${caseId}/documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ documentId: uploadedDocument.id }),
        },
      );
      const attachPayload = await readJson(attachResponse);
      const parsedCase = readCaseDetail(attachPayload.case);
      if (!attachResponse.ok || !parsedCase)
        throw new Error(
          errorMessage(
            attachPayload,
            "Impossible de rattacher la pièce au dossier.",
          ),
        );
      setAdministrativeCase(parsedCase);
      setMessage(
        parsedCase.missingDocuments.length === 0
          ? uploadedDocument.watermarked
            ? "Toutes les pièces sont réunies. Le document sensible a été filigrané, chiffré et ajouté au dossier."
            : "Toutes les pièces sont réunies."
          : uploadedDocument.watermarked
            ? "La pièce a été filigranée, chiffrée et ajoutée au dossier."
            : "La pièce a bien été ajoutée.",
      );
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Le dépôt n’a pas abouti.",
      );
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmCase() {
    if (!confirmationAccepted) {
      setMessage(
        "Confirmez que les informations du récapitulatif sont exactes.",
      );
      setMessageTone("error");
      return;
    }
    setIsBusy(true);
    setMessage("Validation de votre dossier...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/confirm`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);
      const parsedCase = readCaseDetail(payload.case);
      if (!response.ok || !parsedCase)
        throw new Error(
          errorMessage(payload, "Impossible de valider le dossier."),
        );
      setAdministrativeCase(parsedCase);
      setConfirmationAccepted(false);
      setMessage(
        "Votre dossier est validé. Choisissez maintenant comment vous souhaitez poursuivre.",
      );
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de valider le dossier.",
      );
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function chooseFulfillment(mode: FulfillmentMode) {
    if (mode === "MANAGED_POSTAL" && !managedPostalEnabled) {
      setMessage(
        "L’envoi pris en charge sera bientôt disponible. Choisissez le téléchargement gratuit pour continuer.",
      );
      setMessageTone("info");
      return;
    }
    setIsBusy(true);
    setMessage(
      mode === "SELF_SERVICE"
        ? "Préparation de votre dossier gratuit..."
        : "Activation de l’envoi pris en charge...",
    );
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/fulfillment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      const payload = await readJson(response);
      const parsedCase = readCaseDetail(payload.case);
      if (!response.ok || !parsedCase)
        throw new Error(
          errorMessage(payload, "Impossible d’enregistrer votre choix."),
        );
      setAdministrativeCase(parsedCase);
      setFulfillmentSelection(mode);
      setPostalAccepted(false);
      setMessage(
        mode === "SELF_SERVICE"
          ? "Votre dossier complet est prêt à être téléchargé gratuitement."
          : "Lydoc peut maintenant calculer précisément les frais d’impression et d’envoi.",
      );
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible d’enregistrer votre choix.",
      );
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function preparePostalQuote() {
    if (!postalAccepted) {
      setMessage(
        "Autorisez la préparation technique du dossier pour obtenir le devis.",
      );
      setMessageTone("error");
      return;
    }
    setIsBusy(true);
    setMessage("Calcul de l’impression et de l’affranchissement...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/postal-quote`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok)
        throw new Error(
          errorMessage(payload, "Impossible de calculer les frais postaux."),
        );
      const loaded = await loadCase();
      if (!loaded?.postalShipment)
        throw new Error("Le devis postal n’a pas été enregistré.");
      setPostalAccepted(false);
      setMessage(
        loaded.postalShipment.simulation
          ? "Votre devis de test est prêt."
          : "Votre devis est prêt. Aucun paiement n’a encore été effectué.",
      );
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de préparer l’envoi postal.",
      );
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
      const response = await fetch(
        `${apiUrl}/cases/${caseId}/checkout-session`,
        { method: "POST", credentials: "include" },
      );
      const payload = await readJson(response);
      if (!response.ok || typeof payload.url !== "string")
        throw new Error(
          errorMessage(payload, "Impossible d’ouvrir le paiement."),
        );
      window.location.assign(payload.url);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible d’ouvrir le paiement.",
      );
      setMessageTone("error");
      setIsBusy(false);
    }
  }

  async function openPacket() {
    const finalPacket =
      administrativeCase?.fulfillmentMode === "SELF_SERVICE" ||
      administrativeCase?.payment?.status === "PAID";
    setIsBusy(true);
    setMessage(
      finalPacket
        ? "Génération du dossier complet..."
        : "Génération de l’aperçu...",
    );
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/dossier.pdf`, {
        credentials: "include",
      });
      if (!response.ok)
        throw new Error(
          errorMessage(
            await readJson(response),
            "Impossible de générer le dossier.",
          ),
        );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      if (finalPacket) link.download = `dossier-lydoc-${caseId}.pdf`;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(
        finalPacket
          ? "Votre dossier complet a été téléchargé."
          : "L’aperçu est prêt.",
      );
      setMessageTone("success");
      if (administrativeCase?.fulfillmentMode === "SELF_SERVICE")
        await loadCase();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de générer le dossier.",
      );
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshPostalTracking() {
    setIsBusy(true);
    setMessage("Actualisation du suivi postal...");
    setMessageTone("info");
    try {
      const response = await fetch(
        `${apiUrl}/cases/${caseId}/postal-shipment/refresh`,
        { method: "POST", credentials: "include" },
      );
      const payload = await readJson(response);
      if (!response.ok)
        throw new Error(
          errorMessage(payload, "Impossible d’actualiser le suivi."),
        );
      await loadCase();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible d’actualiser le suivi.",
      );
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function markRefunded() {
    if (!window.confirm("Confirmer que vous avez reçu ce remboursement ?"))
      return;
    setIsBusy(true);
    setMessage("Enregistrement du remboursement...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/refunded`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);
      const parsedCase = readCaseDetail(payload.case);
      if (!response.ok || !parsedCase)
        throw new Error(
          errorMessage(payload, "Impossible de confirmer le remboursement."),
        );
      setAdministrativeCase(parsedCase);
      setMessage(
        "Remboursement confirmé. Votre dossier est maintenant terminé.",
      );
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de confirmer le remboursement.",
      );
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function markSent() {
    if (!window.confirm("Confirmer que vous avez envoyé ce dossier ?")) return;
    setIsBusy(true);
    setMessage("Enregistrement de l’envoi...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}/sent`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);
      const parsedCase = readCaseDetail(payload.case);
      if (!response.ok || !parsedCase)
        throw new Error(
          errorMessage(payload, "Impossible de confirmer l’envoi du dossier."),
        );
      setAdministrativeCase(parsedCase);
      setMessage(
        "Envoi confirmé. Vous pouvez maintenant suivre votre remboursement.",
      );
      setMessageTone("success");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de confirmer l’envoi du dossier.",
      );
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteCase() {
    if (
      !window.confirm(
        "Supprimer ce dossier ? Les documents déposés resteront dans votre espace.",
      )
    )
      return;
    setIsBusy(true);
    setMessage("Suppression du dossier...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/cases/${caseId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok || payload.deleted !== true)
        throw new Error(
          errorMessage(payload, "Impossible de supprimer le dossier."),
        );
      router.push("/cases");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de supprimer le dossier.",
      );
      setMessageTone("error");
      setIsBusy(false);
    }
  }

  if (!administrativeCase && messageTone !== "error")
    return <LoadingState label="Chargement du dossier..." />;

  if (!administrativeCase) {
    return (
      <AppShell
        active="cases"
        email={user?.email}
        isAdmin={user?.role === "ADMIN"}
      >
        <div className="page-container max-w-2xl py-16">
          <Notice tone="error">{message}</Notice>
        </div>
      </AppShell>
    );
  }

  const isPaid = administrativeCase.payment?.status === "PAID";
  const currentStep = journeyStep(administrativeCase);

  return (
    <AppShell
      active="cases"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="page-container py-7 sm:py-9">
        <a
          href="/cases"
          className="inline-flex items-center gap-2 text-xs font-bold text-[#66736d] hover:text-[#087a55]"
        >
          <ArrowLeft size={16} /> Retour à mes dossiers
        </a>

        <section className="surface mt-5 overflow-hidden">
          <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase text-[#7c8982]">
                Dossier de remboursement · Réf.{" "}
                {administrativeCase.id.slice(-8).toUpperCase()}
              </p>
              <h1 className="mt-2 truncate text-2xl font-extrabold text-[#17211d] sm:text-[30px]">
                {administrativeCase.rule.name}
              </h1>
              <p className="mt-2 text-sm text-[#66736d]">
                {administrativeCase.rule.organizer} ·{" "}
                {formatCents(administrativeCase.estimatedRecoverableCents)} de
                potentiel identifié
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={administrativeCase.status} />
              <div className="min-w-[142px] rounded-md border border-[#d7e1dc] bg-[#fbfcfb] px-4 py-3">
                <p className="text-[9px] font-extrabold uppercase text-[#849089]">
                  Score de préparation
                </p>
                <p className="mt-1 text-xl font-extrabold text-[#087a55]">
                  {[20, 40, 60, 80, 100][currentStep] ?? 20}
                  <span className="text-xs text-[#7b8781]"> / 100</span>
                </p>
              </div>
              <button
                type="button"
                onClick={deleteCase}
                disabled={isBusy}
                aria-label="Supprimer le dossier"
                title="Supprimer le dossier"
                className="grid h-10 w-10 place-items-center rounded-md text-[#7b8781] hover:bg-[#fff0ec] hover:text-[#b94a35] disabled:opacity-40"
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>
          <div className="border-t border-[#e3e9e6] bg-[#fbfcfb] px-5 py-5 sm:px-7">
            <JourneySteps current={currentStep} />
          </div>
        </section>

        <div className="mt-5">
          <Notice tone={messageTone} busy={isBusy}>
            {message}
          </Notice>
        </div>

        {!administrativeCase.validation &&
        ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"].includes(
          administrativeCase.status,
        ) ? (
          <div className="mx-auto mt-6 max-w-[1020px]">
            <DetectionReviewCard
              smsCount={administrativeCase.review.detectedSmsCount}
              amountCents={administrativeCase.estimatedRecoverableCents}
              isBusy={isBusy}
              onSubmit={updateDetection}
            />
          </div>
        ) : null}

        <div className="mx-auto mt-6 max-w-[1020px]">
          <div>
            {administrativeCase.status === "DRAFT" ? (
              <StartView isBusy={isBusy} onStart={startCase} />
            ) : administrativeCase.missingDocuments.length > 0 ? (
              <DocumentsView
                administrativeCase={administrativeCase}
                isBusy={isBusy}
                onAttach={attachDocument}
              />
            ) : !administrativeCase.validation ? (
              <ReviewView
                administrativeCase={administrativeCase}
                accepted={confirmationAccepted}
                isBusy={isBusy}
                onAccepted={setConfirmationAccepted}
                onPostalExpenseClaim={updatePostalExpenseClaim}
                onConfirm={confirmCase}
                onPreview={openPacket}
              />
            ) : !administrativeCase.fulfillmentMode ? (
              <ChoiceView
                selected={fulfillmentSelection}
                managedPostalEnabled={managedPostalEnabled}
                isBusy={isBusy}
                onSelect={setFulfillmentSelection}
                onContinue={() =>
                  fulfillmentSelection
                    ? chooseFulfillment(fulfillmentSelection)
                    : Promise.resolve()
                }
                onPreview={openPacket}
              />
            ) : administrativeCase.fulfillmentMode === "SELF_SERVICE" ? (
              <SelfServiceView
                administrativeCase={administrativeCase}
                managedPostalEnabled={managedPostalEnabled}
                isBusy={isBusy}
                onDownload={openPacket}
                onSwitch={() => chooseFulfillment("MANAGED_POSTAL")}
                onSent={markSent}
                onRefunded={markRefunded}
              />
            ) : !managedPostalEnabled && !isPaid ? (
              <ManagedPostalUnavailableView
                isBusy={isBusy}
                onFree={() => chooseFulfillment("SELF_SERVICE")}
                onPreview={openPacket}
              />
            ) : !administrativeCase.postalShipment ? (
              <PostalConsentView
                accepted={postalAccepted}
                isBusy={isBusy}
                onAccepted={setPostalAccepted}
                onQuote={preparePostalQuote}
                onFree={() => chooseFulfillment("SELF_SERVICE")}
              />
            ) : !isPaid ? (
              <PostalQuoteView
                administrativeCase={administrativeCase}
                isBusy={isBusy}
                onCheckout={startCheckout}
                onFree={() => chooseFulfillment("SELF_SERVICE")}
              />
            ) : (
              <TrackingView
                administrativeCase={administrativeCase}
                isBusy={isBusy}
                onRefresh={refreshPostalTracking}
                onDownload={openPacket}
                onRefunded={markRefunded}
              />
            )}
          </div>
        </div>

        <footer className="mt-10 flex items-start gap-3 border-t border-[#dfe6e2] pt-5 text-xs leading-5 text-[#66736d]">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#087a55]" />
          <p>
            Lydoc prépare votre dossier à partir du règlement applicable.
            L’acceptation et le délai de remboursement restent sous la
            responsabilité de l’organisateur.
          </p>
        </footer>
      </div>
    </AppShell>
  );
}
