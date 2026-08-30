import {
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  Mail,
  PackageCheck,
  Printer,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { Notice } from "./client-ui";
import { formatCents } from "../lib/client-data";
import {
  documentHelp,
  documentName,
  documentUploadLabel,
  formatPostalStatus,
  missingDocumentPrompt,
  trackingNextStep,
  trackingStages,
  type CaseDetail,
  type FulfillmentMode,
  type RequiredDocument,
} from "../lib/case-detail";

export function StartView({
  isBusy,
  onStart,
}: {
  isBusy: boolean;
  onStart: () => Promise<void>;
}) {
  return (
    <section className="mx-auto max-w-2xl py-5 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e9f5ef] text-[#087a55]">
        <ReceiptText size={22} />
      </span>
      <h2 className="mt-5 text-2xl font-extrabold text-[#17211d]">
        Préparer ce dossier
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#66736d]">
        Lydoc va lire les exigences du règlement et afficher uniquement les
        justificatifs réellement nécessaires.
      </p>
      <button
        type="button"
        onClick={() => void onStart()}
        disabled={isBusy}
        className="primary-button mt-7 min-w-[230px]"
      >
        {isBusy ? (
          <LoaderCircle className="animate-spin" size={17} />
        ) : (
          <ArrowRight size={17} />
        )}{" "}
        Préparer mon dossier
      </button>
    </section>
  );
}

export function DocumentsView({
  administrativeCase,
  isBusy,
  onAttach,
}: {
  administrativeCase: CaseDetail;
  isBusy: boolean;
  onAttach: (kind: string, file: File | undefined) => Promise<void>;
}) {
  const requiredDocuments = administrativeCase.requiredDocuments.filter(
    (item) => item.required,
  );
  const optionalDocuments = administrativeCase.requiredDocuments.filter(
    (item) => !item.required,
  );

  return (
    <section>
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-[#17211d]">
          Complétez votre dossier
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#66736d]">
          Le règlement demande uniquement les pièces ci-dessous.
        </p>
      </div>

      <div className="surface mt-7 divide-y divide-[#e3e9e6] overflow-hidden">
        {requiredDocuments.map((item, index) => (
          <DocumentRequirementRow
            key={`${item.kind}-${index}`}
            item={item}
            inputId={`required-document-${item.kind.toLowerCase()}-${index}`}
            isBusy={isBusy}
            onAttach={onAttach}
          />
        ))}
      </div>

      {optionalDocuments.length > 0 ? (
        <div className="mt-6">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h3 className="text-sm font-extrabold text-[#24332c]">
                Cas particuliers
              </h3>
              <p className="mt-1 text-xs text-[#7b8781]">
                Ces justificatifs ne bloquent pas la préparation du dossier.
              </p>
            </div>
            <span className="rounded-full bg-[#eef2f0] px-3 py-1 text-[10px] font-extrabold uppercase text-[#66736d]">
              Facultatif
            </span>
          </div>
          <div className="surface divide-y divide-[#e3e9e6] overflow-hidden">
            {optionalDocuments.map((item, index) => (
              <DocumentRequirementRow
                key={`${item.kind}-${index}`}
                item={item}
                inputId={`optional-document-${item.kind.toLowerCase()}-${index}`}
                isBusy={isBusy}
                onAttach={onAttach}
              />
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-5 flex items-center justify-center gap-2 text-xs text-[#66736d]">
        <LockKeyhole size={14} /> RIB et pièces d’identité sont filigranés, puis
        tous les documents sont chiffrés.
      </p>
      <div className="mt-7 text-center">
        <button type="button" disabled className="primary-button min-w-[190px]">
          Continuer
        </button>
        <p className="mt-3 text-xs text-[#7b8781]">
          {missingDocumentPrompt(administrativeCase.missingDocuments[0])}
        </p>
      </div>
    </section>
  );
}

function DocumentRequirementRow({
  item,
  inputId,
  isBusy,
  onAttach,
}: {
  item: RequiredDocument;
  inputId: string;
  isBusy: boolean;
  onAttach: (kind: string, file: File | undefined) => Promise<void>;
}) {
  return (
    <div className="grid gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-md ${
            item.supplied
              ? "bg-[#eaf8f1] text-[#16875b]"
              : "bg-[#e9f5ef] text-[#087a55]"
          }`}
        >
          {item.supplied ? (
            <FileCheck2 size={20} />
          ) : item.kind === "BANK_DETAILS" ? (
            <Landmark size={20} />
          ) : (
            <FileText size={20} />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-[#24332c]">
            {documentName(item)}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#7b8781]">
            {item.supplied
              ? "Document ajouté au dossier."
              : item.documentId
                ? "Remplacez cet ancien fichier pour appliquer le filigrane."
                : documentHelp(item)}
          </p>
        </div>
      </div>
      {item.supplied ? (
        <p className="flex items-center gap-2 text-sm font-bold text-[#16875b]">
          <CheckCircle2 size={17} /> Ajouté
        </p>
      ) : (
        <>
          <input
            id={inputId}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            disabled={isBusy}
            className="sr-only"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              void onAttach(item.kind, event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <label
              htmlFor={inputId}
              title={item.documentId ? "Remplacer le document" : undefined}
              className={`secondary-button cursor-pointer whitespace-nowrap ${
                isBusy ? "pointer-events-none opacity-45" : ""
              } ${item.documentId ? "h-11 w-11 justify-center px-0" : ""}`}
            >
              <UploadCloud size={16} />
              {item.documentId ? (
                <span className="sr-only">Remplacer le document</span>
              ) : (
                documentUploadLabel(item)
              )}
            </label>
          </div>
        </>
      )}
    </div>
  );
}

export function ReviewView({
  administrativeCase,
  accepted,
  isBusy,
  onAccepted,
  onPostalExpenseClaim,
  onConfirm,
  onPreview,
}: {
  administrativeCase: CaseDetail;
  accepted: boolean;
  isBusy: boolean;
  onAccepted: (accepted: boolean) => void;
  onPostalExpenseClaim: (requested: boolean) => Promise<void>;
  onConfirm: () => Promise<void>;
  onPreview: () => Promise<void>;
}) {
  return (
    <section>
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-[#17211d]">
          Vérifiez votre demande
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#66736d]">
          Ces informations seront utilisées dans la lettre de remboursement.
        </p>
      </div>

      {!administrativeCase.customerProfile.complete ? (
        <div className="mt-7">
          <Notice tone="error">
            <p className="font-extrabold">Votre profil doit être complété.</p>
            <p>{administrativeCase.customerProfile.missingFields.join(", ")}</p>
            <a
              href="/profile"
              className="mt-2 inline-flex font-extrabold text-[#087a55]"
            >
              Compléter mes informations{" "}
              <ArrowRight size={15} className="ml-1" />
            </a>
          </Notice>
        </div>
      ) : null}

      <dl className="surface mt-7 divide-y divide-[#e3e9e6] px-5 sm:px-7">
        <ReviewLine label="Jeu" value={administrativeCase.rule.name} />
        <ReviewLine
          label="Organisateur"
          value={administrativeCase.review.reimbursementRecipient}
        />
        <ReviewLine
          label="Adresse d’envoi"
          value={administrativeCase.review.reimbursementAddress}
        />
        <ReviewLine
          label="Date limite"
          value={administrativeCase.review.reimbursementDeadline}
        />
        <ReviewLine
          label="SMS détectés"
          value={String(administrativeCase.review.detectedSmsCount)}
        />
        <ReviewLine
          label="Montant demandé"
          value={formatCents(administrativeCase.estimatedRecoverableCents)}
          strong
        />
      </dl>

      {administrativeCase.review.postalExpenseReimbursement.available ? (
        <PostalExpenseClaimOption
          administrativeCase={administrativeCase}
          isBusy={isBusy}
          onChange={onPostalExpenseClaim}
        />
      ) : null}

      <label className="mx-auto mt-7 flex max-w-2xl cursor-pointer items-start gap-3 text-sm leading-6 text-[#526058]">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAccepted(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[#087a55]"
        />
        <span>
          Je confirme que mes coordonnées, les pièces et les informations
          ci-dessus sont exactes.
        </span>
      </label>

      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={
            isBusy || !accepted || !administrativeCase.customerProfile.complete
          }
          className="primary-button min-w-[220px]"
        >
          <ShieldCheck size={17} /> Valider mon dossier
        </button>
        <button
          type="button"
          onClick={() => void onPreview()}
          disabled={isBusy}
          className="secondary-button"
        >
          <Eye size={16} /> Voir l’aperçu
        </button>
      </div>
    </section>
  );
}

function PostalExpenseClaimOption({
  administrativeCase,
  isBusy,
  onChange,
}: {
  administrativeCase: CaseDetail;
  isBusy: boolean;
  onChange: (requested: boolean) => Promise<void>;
}) {
  const reimbursement =
    administrativeCase.review.postalExpenseReimbursement;
  const limit = postalExpenseLimit(reimbursement);

  return (
    <section className="surface mt-5 overflow-hidden border-[#b9d8c9]">
      <label className="flex cursor-pointer items-start gap-4 p-5 sm:p-6">
        <input
          type="checkbox"
          checked={reimbursement.requested}
          disabled={isBusy || reimbursement.locked}
          onChange={(event) => void onChange(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-[#087a55]"
        />
        <span className="min-w-0">
          <span className="block font-extrabold text-[#17211d]">
            Demander aussi mes frais d’envoi et d’impression
          </span>
          <span className="mt-1 block text-sm leading-6 text-[#66736d]">
            Le règlement permet d’ajouter cette demande à votre lettre. Le
            remboursement reste soumis à ses conditions.
          </span>
        </span>
      </label>

      <div className="grid border-t border-[#e3e9e6] bg-[#fbfcfb] sm:grid-cols-2 sm:divide-x sm:divide-[#e3e9e6]">
        {reimbursement.postage.reimbursable ? (
          <PostalExpenseLine
            icon={<Mail size={17} />}
            label="Affranchissement"
            value={postalExpensePostageLabel(reimbursement)}
          />
        ) : null}
        {reimbursement.printing.reimbursable ? (
          <PostalExpenseLine
            icon={<Printer size={17} />}
            label="Impression"
            value={postalExpensePrintingLabel(reimbursement)}
          />
        ) : null}
      </div>

      {limit ? (
        <div
          className={`border-t px-5 py-4 text-sm leading-6 sm:px-6 ${
            reimbursement.claimLimit.strict
              ? "border-[#f1d9b8] bg-[#fff8ee] text-[#8a5515]"
              : "border-[#dce7e1] bg-[#f3f8f5] text-[#456456]"
          }`}
        >
          <strong>
            {reimbursement.claimLimit.strict
              ? "Attention à la limite : "
              : "Indication du règlement : "}
          </strong>
          {limit}
        </div>
      ) : null}

      {reimbursement.requestInstructions ? (
        <p className="border-t border-[#e3e9e6] px-5 py-4 text-xs leading-5 text-[#526058] sm:px-6">
          Modalité prévue : {reimbursement.requestInstructions}
        </p>
      ) : null}

      {reimbursement.requiredProofs.length > 0 ? (
        <p className="border-t border-[#e3e9e6] px-5 py-4 text-xs leading-5 text-[#66736d] sm:px-6">
          Justificatifs indiqués : {reimbursement.requiredProofs.join(", ")}.
        </p>
      ) : null}
    </section>
  );
}

function PostalExpenseLine({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-4 sm:px-6">
      <span className="mt-0.5 text-[#087a55]">{icon}</span>
      <span>
        <strong className="block text-sm text-[#24332c]">{label}</strong>
        <span className="mt-1 block text-xs leading-5 text-[#66736d]">
          {value}
        </span>
      </span>
    </div>
  );
}

function postalExpensePostageLabel(
  reimbursement: CaseDetail["review"]["postalExpenseReimbursement"],
): string {
  const postage = reimbursement.postage;
  if (postage.amountCents !== null) return formatCents(postage.amountCents);
  return postage.basis || "Selon le tarif postal prévu par le règlement";
}

function postalExpensePrintingLabel(
  reimbursement: CaseDetail["review"]["postalExpenseReimbursement"],
): string {
  const printing = reimbursement.printing;
  if (printing.centsPerPage !== null) {
    return `${formatCents(printing.centsPerPage)} par page${
      printing.maxPages ? `, dans la limite de ${printing.maxPages} pages` : ""
    }`;
  }
  return printing.basis || "Selon le barème prévu par le règlement";
}

function postalExpenseLimit(
  reimbursement: CaseDetail["review"]["postalExpenseReimbursement"],
): string {
  if (reimbursement.claimLimit.details) {
    return reimbursement.claimLimit.details;
  }
  const labels = {
    PER_REQUEST: "Le remboursement peut être demandé avec chaque demande.",
    PER_PARTICIPANT_PER_MONTH:
      "Une seule demande par participant et par mois.",
    PER_PARTICIPANT_PER_GAME:
      "Une seule demande par participant pour toute la durée du jeu.",
    PER_HOUSEHOLD_PER_GAME:
      "Une seule demande par foyer pour toute la durée du jeu.",
    OTHER: "Une limite particulière est prévue par le règlement.",
    UNSPECIFIED: "",
  } as const;
  return labels[reimbursement.claimLimit.scope];
}

export function ChoiceView({
  selected,
  managedPostalEnabled,
  isBusy,
  onSelect,
  onContinue,
  onPreview,
}: {
  selected: FulfillmentMode | null;
  managedPostalEnabled: boolean;
  isBusy: boolean;
  onSelect: (mode: FulfillmentMode) => void;
  onContinue: () => Promise<void>;
  onPreview: () => Promise<void>;
}) {
  return (
    <section>
      <div className="text-center">
        <p className="text-xs font-extrabold uppercase text-[#16875b]">
          Dossier validé
        </p>
        <h2 className="mt-3 text-2xl font-extrabold text-[#17211d]">
          Comment souhaitez-vous poursuivre ?
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#66736d]">
          Le dossier est identique dans les deux formules. Seule la prise en
          charge de l’envoi change.
        </p>
      </div>

      <div className="mt-8 grid gap-3">
        <ChoiceButton
          selected={selected === "SELF_SERVICE"}
          icon={<Download size={20} />}
          title="Je télécharge gratuitement"
          description="Recevez le dossier complet, puis imprimez-le et postez-le vous-même."
          price="0 €"
          onClick={() => onSelect("SELF_SERVICE")}
        />
        <ChoiceButton
          selected={selected === "MANAGED_POSTAL"}
          disabled={!managedPostalEnabled}
          icon={<Send size={20} />}
          title="Lydoc l’envoie pour moi"
          description={
            managedPostalEnabled
              ? "Vérification, impression, mise sous pli, lettre verte suivie et suivi."
              : "L’impression et l’envoi suivi seront proposés dans une prochaine version."
          }
          price={managedPostalEnabled ? "Sur devis" : "Bientôt disponible"}
          onClick={() => onSelect("MANAGED_POSTAL")}
        />
      </div>

      <div className="mt-7 text-center">
        <button
          type="button"
          onClick={() => void onContinue()}
          disabled={!selected || isBusy}
          className="primary-button min-w-[220px]"
        >
          {isBusy ? <LoaderCircle className="animate-spin" size={17} /> : null}{" "}
          Continuer <ArrowRight size={17} />
        </button>
        <button
          type="button"
          onClick={() => void onPreview()}
          disabled={isBusy}
          className="mx-auto mt-4 flex items-center gap-2 text-sm font-bold text-[#66736d] hover:text-[#087a55]"
        >
          <Eye size={15} /> Consulter le dossier avant de choisir
        </button>
      </div>
    </section>
  );
}

function ChoiceButton({
  selected,
  disabled = false,
  icon,
  title,
  description,
  price,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  price: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`grid min-h-[104px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 rounded-md border-2 p-4 text-left transition-colors sm:px-5 ${disabled ? "cursor-not-allowed border-[#e0e6e3] bg-[#f8faf9] opacity-75" : selected ? "border-[#087a55] bg-[#f2f8f5]" : "border-[#d7dfe9] bg-white hover:border-[#9fc5b2]"}`}
    >
      <span
        className={`grid h-11 w-11 place-items-center rounded-md ${disabled ? "bg-[#eef2f0] text-[#849089]" : selected ? "bg-[#087a55] text-white" : "bg-[#e9f5ef] text-[#087a55]"}`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-extrabold text-[#24332c]">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[#66736d]">
          {description}
        </span>
      </span>
      <span
        className={`max-w-[145px] text-right text-xs font-extrabold sm:text-sm ${disabled ? "text-[#66736d]" : "text-[#17211d]"}`}
      >
        {price}
      </span>
    </button>
  );
}

export function SelfServiceView({
  administrativeCase,
  managedPostalEnabled,
  isBusy,
  onDownload,
  onSwitch,
  onRefunded,
}: {
  administrativeCase: CaseDetail;
  managedPostalEnabled: boolean;
  isBusy: boolean;
  onDownload: () => Promise<void>;
  onSwitch: () => Promise<void>;
  onRefunded: () => Promise<void>;
}) {
  const refunded = administrativeCase.status === "REFUNDED";
  return (
    <section className="mx-auto max-w-3xl text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eaf8f1] text-[#16875b]">
        {refunded ? <CheckCircle2 size={23} /> : <Download size={22} />}
      </span>
      <p className="mt-5 text-xs font-extrabold uppercase text-[#16875b]">
        Formule gratuite
      </p>
      <h2 className="mt-3 text-2xl font-extrabold text-[#17211d]">
        {refunded
          ? "Votre remboursement est confirmé."
          : "Votre dossier complet est prêt."}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#66736d]">
        Le PDF contient la lettre de demande et toutes les pièces exigées par le
        règlement.
      </p>

      <div className="surface mt-7 divide-y divide-[#e3e9e6] text-left">
        <GuideLine
          number="1"
          text="Téléchargez et vérifiez le dossier complet."
        />
        <GuideLine
          number="2"
          text="Imprimez-le et signez la lettre si nécessaire."
        />
        <GuideLine
          number="3"
          text={`Envoyez-le à ${administrativeCase.review.reimbursementRecipient}.`}
        />
      </div>

      <button
        type="button"
        onClick={() => void onDownload()}
        disabled={isBusy}
        className="primary-button mt-7 min-w-[270px]"
      >
        <Download size={17} /> Télécharger mon dossier complet
      </button>
      {!refunded && managedPostalEnabled ? (
        <div className="mt-5 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => void onSwitch()}
            disabled={isBusy}
            className="text-sm font-extrabold text-[#087a55] hover:text-[#066344]"
          >
            Je préfère confier l’envoi à Lydoc
          </button>
          <button
            type="button"
            onClick={() => void onRefunded()}
            disabled={isBusy}
            className="text-sm font-semibold text-[#66736d] hover:text-[#16875b]"
          >
            J’ai reçu mon remboursement
          </button>
        </div>
      ) : !refunded ? (
        <div className="mt-5 flex flex-col items-center gap-3">
          <p className="inline-flex items-center gap-2 rounded-md border border-[#d7e1dc] bg-white px-4 py-3 text-sm font-bold text-[#526058]">
            <Send size={16} className="text-[#087a55]" />
            Envoi par Lydoc : bientôt disponible
          </p>
          <button
            type="button"
            onClick={() => void onRefunded()}
            disabled={isBusy}
            className="text-sm font-semibold text-[#66736d] hover:text-[#16875b]"
          >
            J’ai reçu mon remboursement
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function ManagedPostalUnavailableView({
  isBusy,
  onFree,
  onPreview,
}: {
  isBusy: boolean;
  onFree: () => Promise<void>;
  onPreview: () => Promise<void>;
}) {
  return (
    <section className="mx-auto max-w-3xl text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e9f5ef] text-[#087a55]">
        <Send size={22} />
      </span>
      <p className="mt-5 text-xs font-extrabold uppercase text-[#087a55]">
        Bientôt disponible
      </p>
      <h2 className="mt-3 text-2xl font-extrabold text-[#17211d]">
        L’envoi pris en charge est en préparation.
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#66736d]">
        Vous pouvez dès maintenant télécharger gratuitement votre dossier
        complet, puis l’imprimer et l’envoyer vous-même.
      </p>
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => void onFree()}
          disabled={isBusy}
          className="primary-button min-w-[230px]"
        >
          <Download size={17} /> Choisir l’option gratuite
        </button>
        <button
          type="button"
          onClick={() => void onPreview()}
          disabled={isBusy}
          className="secondary-button"
        >
          <Eye size={16} /> Voir mon dossier
        </button>
      </div>
    </section>
  );
}

export function PostalConsentView({
  accepted,
  isBusy,
  onAccepted,
  onQuote,
  onFree,
}: {
  accepted: boolean;
  isBusy: boolean;
  onAccepted: (value: boolean) => void;
  onQuote: () => Promise<void>;
  onFree: () => Promise<void>;
}) {
  return (
    <section className="mx-auto max-w-3xl text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e9f5ef] text-[#087a55]">
        <Send size={22} />
      </span>
      <p className="mt-5 text-xs font-extrabold uppercase text-[#087a55]">
        Envoi pris en charge
      </p>
      <h2 className="mt-3 text-2xl font-extrabold text-[#17211d]">
        Lydoc prépare votre courrier
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#66736d]">
        Nous calculons le prix exact avant tout paiement. Rien ne sera envoyé
        sans votre validation.
      </p>

      <div className="mt-7 grid gap-4 border-y border-[#e3e9e6] py-6 text-sm text-[#59665f] sm:grid-cols-3">
        <SmallFeature
          icon={<FileCheck2 size={18} />}
          label="Vérification finale"
        />
        <SmallFeature
          icon={<PackageCheck size={18} />}
          label="Impression et pli"
        />
        <SmallFeature icon={<Send size={18} />} label="Lettre verte suivie" />
      </div>

      <label className="mx-auto mt-7 flex max-w-2xl cursor-pointer items-start gap-3 text-left text-sm leading-6 text-[#526058]">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAccepted(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[#087a55]"
        />
        <span>
          J’autorise la génération technique du PDF pour calculer les frais
          d’impression et d’affranchissement.
        </span>
      </label>
      <button
        type="button"
        onClick={() => void onQuote()}
        disabled={!accepted || isBusy}
        className="primary-button mt-6 min-w-[230px]"
      >
        <ReceiptText size={17} /> Obtenir mon devis
      </button>
      <button
        type="button"
        onClick={() => void onFree()}
        disabled={isBusy}
        className="mx-auto mt-4 block text-sm font-bold text-[#66736d] hover:text-[#087a55]"
      >
        Revenir à l’option gratuite
      </button>
    </section>
  );
}

export function PostalQuoteView({
  administrativeCase,
  isBusy,
  onCheckout,
  onFree,
}: {
  administrativeCase: CaseDetail;
  isBusy: boolean;
  onCheckout: () => Promise<void>;
  onFree: () => Promise<void>;
}) {
  const shipment = administrativeCase.postalShipment!;
  const total = administrativeCase.serviceFeeCents + shipment.totalCents;
  return (
    <section className="mx-auto max-w-2xl">
      <div className="text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#e9f5ef] text-[#087a55]">
          <Banknote size={22} />
        </span>
        <p className="mt-5 text-xs font-extrabold uppercase text-[#087a55]">
          Devis prêt
        </p>
        <h2 className="mt-3 text-2xl font-extrabold text-[#17211d]">
          Vérifiez le prix avant de payer
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#66736d]">
          Le paiement déclenchera automatiquement l’impression et l’envoi.
        </p>
      </div>

      <dl className="surface mt-7 divide-y divide-[#e3e9e6] px-5 sm:px-7">
        <ReviewLine
          label="Service Lydoc"
          value={formatCents(administrativeCase.serviceFeeCents)}
        />
        <ReviewLine
          label="Impression et mise sous pli"
          value={formatCents(shipment.printingCents)}
        />
        <ReviewLine
          label={
            shipment.product === "vertesuivi"
              ? "Lettre verte suivie"
              : "Lettre verte"
          }
          value={formatCents(shipment.postageCents)}
        />
        <ReviewLine label="Total" value={formatCents(total)} strong />
      </dl>
      {shipment.simulation ? (
        <p className="mt-4 text-center text-xs font-bold text-[#9a5a17]">
          Environnement de test : aucun courrier réel ne sera expédié.
        </p>
      ) : null}
      {shipment.errorMessage ? (
        <div className="mt-5">
          <Notice tone="error">{shipment.errorMessage}</Notice>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void onCheckout()}
        disabled={isBusy || shipment.status !== "QUOTED"}
        className="primary-button mt-7 w-full"
      >
        <CircleDollarSign size={18} /> Payer {formatCents(total)}
      </button>
      <button
        type="button"
        onClick={() => void onFree()}
        disabled={isBusy}
        className="mx-auto mt-4 block text-sm font-bold text-[#66736d] hover:text-[#087a55]"
      >
        Choisir le téléchargement gratuit
      </button>
    </section>
  );
}

export function TrackingView({
  administrativeCase,
  isBusy,
  onRefresh,
  onDownload,
  onRefunded,
}: {
  administrativeCase: CaseDetail;
  isBusy: boolean;
  onRefresh: () => Promise<void>;
  onDownload: () => Promise<void>;
  onRefunded: () => Promise<void>;
}) {
  const shipment = administrativeCase.postalShipment!;
  const refunded = administrativeCase.status === "REFUNDED";
  const stages = trackingStages(administrativeCase);
  const canRefresh = [
    "SUBMITTED",
    "PRODUCED",
    "HANDED_OVER",
    "IN_TRANSIT",
  ].includes(shipment.status);

  return (
    <section>
      <div className="text-center">
        <p className="text-xs font-extrabold uppercase text-[#7c8982]">
          Suivi du dossier
        </p>
        <h2 className="mt-3 text-2xl font-extrabold text-[#17211d]">
          {refunded ? "Remboursement reçu" : "Suivi de votre remboursement"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#66736d]">
          {formatPostalStatus(shipment.status)}
        </p>
      </div>

      <div className="surface mt-7 grid overflow-hidden lg:grid-cols-[1.15fr_0.85fr] lg:divide-x lg:divide-[#e3e9e6]">
        <div className="p-6 sm:p-8">
          <ol>
            {stages.map((stage, index) => (
              <li
                key={stage.label}
                className="relative flex gap-4 pb-7 last:pb-0"
              >
                {index < stages.length - 1 ? (
                  <span
                    className={`absolute left-[15px] top-8 h-[calc(100%-20px)] w-px ${stage.complete ? "bg-[#16875b]" : "bg-[#d7deea]"}`}
                  />
                ) : null}
                <span
                  className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-extrabold ${stage.complete ? "border-[#16875b] bg-[#16875b] text-white" : stage.active ? "border-[#087a55] bg-white text-[#087a55]" : "border-[#cbd4e1] bg-white text-[#7b8781]"}`}
                >
                  {stage.complete ? (
                    <Check size={15} strokeWidth={3} />
                  ) : (
                    index + 1
                  )}
                </span>
                <div className="pt-1">
                  <p className="text-sm font-extrabold text-[#24332c]">
                    {stage.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#66736d]">
                    {stage.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="border-t border-[#e3e9e6] p-6 sm:p-8 lg:border-t-0">
          <p className="text-xs font-bold text-[#7b8781]">N° de suivi</p>
          <p className="mt-2 text-lg font-extrabold text-[#17211d]">
            {shipment.trackingNumber ?? "En cours d’attribution"}
          </p>
          <div className="my-6 h-px bg-[#e3e9e6]" />
          <p className="text-xs font-bold text-[#7b8781]">Prochaine étape</p>
          <p className="mt-2 text-sm font-extrabold leading-6 text-[#24332c]">
            {trackingNextStep(administrativeCase)}
          </p>
          {canRefresh ? (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isBusy}
              className="secondary-button mt-6 w-full"
            >
              <RefreshCw size={16} /> Actualiser le suivi
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={isBusy}
            className="mt-4 flex items-center gap-2 text-sm font-bold text-[#66736d] hover:text-[#087a55]"
          >
            <Download size={15} /> Télécharger une copie du dossier
          </button>
        </div>
      </div>

      {!refunded ? (
        <div className="mt-8 text-center">
          <h3 className="text-lg font-extrabold text-[#17211d]">
            Vous avez reçu le remboursement ?
          </h3>
          <button
            type="button"
            onClick={() => void onRefunded()}
            disabled={isBusy}
            className="primary-button mt-5 min-w-[240px]"
          >
            Marquer comme remboursé
          </button>
          <a
            href="/contact"
            className="mx-auto mt-4 block text-sm font-bold text-[#66736d] hover:text-[#087a55]"
          >
            Signaler un problème
          </a>
        </div>
      ) : null}
    </section>
  );
}

function ReviewLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr]">
      <dt className="text-sm font-bold text-[#7b8781]">{label}</dt>
      <dd
        className={`text-sm ${strong ? "text-lg font-extrabold text-[#17211d]" : "font-semibold text-[#526058]"}`}
      >
        {value || "Non renseigné"}
      </dd>
    </div>
  );
}

function GuideLine({ number, text }: { number: string; text: string }) {
  return (
    <div className="flex items-start gap-4 px-5 py-4 sm:px-6">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#eaf8f1] text-xs font-extrabold text-[#16875b]">
        {number}
      </span>
      <p className="pt-1 text-sm text-[#59665f]">{text}</p>
    </div>
  );
}

function SmallFeature({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <p className="flex items-center justify-center gap-2">
      <span className="text-[#087a55]">{icon}</span>
      {label}
    </p>
  );
}
