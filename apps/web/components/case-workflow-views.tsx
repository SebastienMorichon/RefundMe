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
  PackageCheck,
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
  formatPostalStatus,
  trackingNextStep,
  trackingStages,
  type CaseDetail,
  type FulfillmentMode,
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
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef3ff] text-[#2457f5]">
        <ReceiptText size={22} />
      </span>
      <h2 className="mt-5 text-2xl font-extrabold text-[#101a34]">
        Préparer ce dossier
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#667189]">
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
  return (
    <section>
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-[#101a34]">
          Complétez votre dossier
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#667189]">
          Le règlement demande uniquement les pièces ci-dessous.
        </p>
      </div>

      <div className="surface mt-7 divide-y divide-[#e2e7ee] overflow-hidden">
        {administrativeCase.requiredDocuments.map((item) => {
          const inputId = `document-${item.kind.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
          return (
            <div
              key={item.kind}
              className="grid gap-4 px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6"
            >
              <div className="flex min-w-0 items-center gap-4">
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-md ${item.supplied ? "bg-[#eaf8f1] text-[#16875b]" : "bg-[#eef3ff] text-[#2457f5]"}`}
                >
                  {item.supplied ? (
                    <FileCheck2 size={20} />
                  ) : item.kind === "BANK_DETAILS" ? (
                    <Landmark size={20} />
                  ) : (
                    <FileText size={20} />
                  )}
                </span>
                <div>
                  <p className="text-sm font-extrabold text-[#17213b]">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#7a8499]">
                    {item.supplied
                      ? "Ajoutée au dossier"
                      : documentHelp(item.kind)}
                  </p>
                </div>
              </div>
              {item.supplied ? (
                <p className="flex items-center gap-2 text-sm font-bold text-[#16875b]">
                  <CheckCircle2 size={17} /> Ajoutée
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
                  <label
                    htmlFor={inputId}
                    className={`secondary-button cursor-pointer ${isBusy ? "pointer-events-none opacity-45" : ""}`}
                  >
                    {isBusy ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <UploadCloud size={16} />
                    )}{" "}
                    Ajouter {item.label.toLowerCase()}
                  </label>
                </>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-5 flex items-center justify-center gap-2 text-xs text-[#667189]">
        <LockKeyhole size={14} /> Vos documents sont chiffrés et utilisés
        uniquement pour ce dossier.
      </p>
      <div className="mt-7 text-center">
        <button type="button" disabled className="primary-button min-w-[190px]">
          Continuer
        </button>
        <p className="mt-3 text-xs text-[#7a8499]">
          Ajoutez{" "}
          {administrativeCase.missingDocuments[0]?.label.toLowerCase() ??
            "la pièce manquante"}{" "}
          pour continuer.
        </p>
      </div>
    </section>
  );
}

export function ReviewView({
  administrativeCase,
  accepted,
  isBusy,
  onAccepted,
  onConfirm,
  onPreview,
}: {
  administrativeCase: CaseDetail;
  accepted: boolean;
  isBusy: boolean;
  onAccepted: (accepted: boolean) => void;
  onConfirm: () => Promise<void>;
  onPreview: () => Promise<void>;
}) {
  return (
    <section>
      <div className="text-center">
        <h2 className="text-2xl font-extrabold text-[#101a34]">
          Vérifiez votre demande
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#667189]">
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
              className="mt-2 inline-flex font-extrabold text-[#2457f5]"
            >
              Compléter mes informations{" "}
              <ArrowRight size={15} className="ml-1" />
            </a>
          </Notice>
        </div>
      ) : null}

      <dl className="surface mt-7 divide-y divide-[#e2e7ee] px-5 sm:px-7">
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

      <label className="mx-auto mt-7 flex max-w-2xl cursor-pointer items-start gap-3 text-sm leading-6 text-[#34415d]">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAccepted(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[#2457f5]"
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

export function ChoiceView({
  selected,
  isBusy,
  onSelect,
  onContinue,
  onPreview,
}: {
  selected: FulfillmentMode | null;
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
        <h2 className="mt-3 text-2xl font-extrabold text-[#101a34]">
          Comment souhaitez-vous poursuivre ?
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#667189]">
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
          icon={<Send size={20} />}
          title="Lydoc l’envoie pour moi"
          description="Vérification, impression, mise sous pli, lettre verte suivie et suivi."
          price="Sur devis"
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
          className="mx-auto mt-4 flex items-center gap-2 text-sm font-bold text-[#667189] hover:text-[#2457f5]"
        >
          <Eye size={15} /> Consulter le dossier avant de choisir
        </button>
      </div>
    </section>
  );
}

function ChoiceButton({
  selected,
  icon,
  title,
  description,
  price,
  onClick,
}: {
  selected: boolean;
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
      aria-pressed={selected}
      className={`grid min-h-[104px] grid-cols-[44px_1fr_auto] items-center gap-4 rounded-md border-2 p-4 text-left transition-colors sm:px-5 ${selected ? "border-[#2457f5] bg-[#f5f7ff]" : "border-[#d7dfe9] bg-white hover:border-[#9db2ee]"}`}
    >
      <span
        className={`grid h-11 w-11 place-items-center rounded-md ${selected ? "bg-[#2457f5] text-white" : "bg-[#eef3ff] text-[#2457f5]"}`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-extrabold text-[#17213b]">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[#667189]">
          {description}
        </span>
      </span>
      <span className="text-sm font-extrabold text-[#101a34]">{price}</span>
    </button>
  );
}

export function SelfServiceView({
  administrativeCase,
  isBusy,
  onDownload,
  onSwitch,
  onRefunded,
}: {
  administrativeCase: CaseDetail;
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
      <h2 className="mt-3 text-2xl font-extrabold text-[#101a34]">
        {refunded
          ? "Votre remboursement est confirmé."
          : "Votre dossier complet est prêt."}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#667189]">
        Le PDF contient la lettre de demande et toutes les pièces exigées par le
        règlement.
      </p>

      <div className="surface mt-7 divide-y divide-[#e2e7ee] text-left">
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
      {!refunded ? (
        <div className="mt-5 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => void onSwitch()}
            disabled={isBusy}
            className="text-sm font-extrabold text-[#2457f5] hover:text-[#1947d8]"
          >
            Je préfère confier l’envoi à Lydoc
          </button>
          <button
            type="button"
            onClick={() => void onRefunded()}
            disabled={isBusy}
            className="text-sm font-semibold text-[#667189] hover:text-[#16875b]"
          >
            J’ai reçu mon remboursement
          </button>
        </div>
      ) : null}
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
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef3ff] text-[#2457f5]">
        <Send size={22} />
      </span>
      <p className="mt-5 text-xs font-extrabold uppercase text-[#2457f5]">
        Envoi pris en charge
      </p>
      <h2 className="mt-3 text-2xl font-extrabold text-[#101a34]">
        Lydoc prépare votre courrier
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#667189]">
        Nous calculons le prix exact avant tout paiement. Rien ne sera envoyé
        sans votre validation.
      </p>

      <div className="mt-7 grid gap-4 border-y border-[#e2e7ee] py-6 text-sm text-[#536078] sm:grid-cols-3">
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

      <label className="mx-auto mt-7 flex max-w-2xl cursor-pointer items-start gap-3 text-left text-sm leading-6 text-[#34415d]">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAccepted(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[#2457f5]"
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
        className="mx-auto mt-4 block text-sm font-bold text-[#667189] hover:text-[#2457f5]"
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
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef3ff] text-[#2457f5]">
          <Banknote size={22} />
        </span>
        <p className="mt-5 text-xs font-extrabold uppercase text-[#2457f5]">
          Devis prêt
        </p>
        <h2 className="mt-3 text-2xl font-extrabold text-[#101a34]">
          Vérifiez le prix avant de payer
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#667189]">
          Le paiement déclenchera automatiquement l’impression et l’envoi.
        </p>
      </div>

      <dl className="surface mt-7 divide-y divide-[#e2e7ee] px-5 sm:px-7">
        <ReviewLine
          label="Service Lydoc"
          value={formatCents(administrativeCase.serviceFeeCents)}
        />
        <ReviewLine
          label="Impression et envoi"
          value={formatCents(shipment.totalCents)}
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
        className="mx-auto mt-4 block text-sm font-bold text-[#667189] hover:text-[#2457f5]"
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
        <p className="text-xs font-extrabold uppercase text-[#6f7b92]">
          Suivi du dossier
        </p>
        <h2 className="mt-3 text-2xl font-extrabold text-[#101a34]">
          {refunded ? "Remboursement reçu" : "Suivi de votre remboursement"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#667189]">
          {formatPostalStatus(shipment.status)}
        </p>
      </div>

      <div className="surface mt-7 grid overflow-hidden lg:grid-cols-[1.15fr_0.85fr] lg:divide-x lg:divide-[#e2e7ee]">
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
                  className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-extrabold ${stage.complete ? "border-[#16875b] bg-[#16875b] text-white" : stage.active ? "border-[#2457f5] bg-white text-[#2457f5]" : "border-[#cbd4e1] bg-white text-[#7a8499]"}`}
                >
                  {stage.complete ? (
                    <Check size={15} strokeWidth={3} />
                  ) : (
                    index + 1
                  )}
                </span>
                <div className="pt-1">
                  <p className="text-sm font-extrabold text-[#17213b]">
                    {stage.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#667189]">
                    {stage.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="border-t border-[#e2e7ee] p-6 sm:p-8 lg:border-t-0">
          <p className="text-xs font-bold text-[#7a8499]">N° de suivi</p>
          <p className="mt-2 text-lg font-extrabold text-[#101a34]">
            {shipment.trackingNumber ?? "En cours d’attribution"}
          </p>
          <div className="my-6 h-px bg-[#e2e7ee]" />
          <p className="text-xs font-bold text-[#7a8499]">Prochaine étape</p>
          <p className="mt-2 text-sm font-extrabold leading-6 text-[#17213b]">
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
            className="mt-4 flex items-center gap-2 text-sm font-bold text-[#667189] hover:text-[#2457f5]"
          >
            <Download size={15} /> Télécharger une copie du dossier
          </button>
        </div>
      </div>

      {!refunded ? (
        <div className="mt-8 text-center">
          <h3 className="text-lg font-extrabold text-[#101a34]">
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
            className="mx-auto mt-4 block text-sm font-bold text-[#667189] hover:text-[#2457f5]"
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
      <dt className="text-sm font-bold text-[#7a8499]">{label}</dt>
      <dd
        className={`text-sm ${strong ? "text-lg font-extrabold text-[#101a34]" : "font-semibold text-[#34415d]"}`}
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
      <p className="pt-1 text-sm text-[#536078]">{text}</p>
    </div>
  );
}

function SmallFeature({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <p className="flex items-center justify-center gap-2">
      <span className="text-[#2457f5]">{icon}</span>
      {label}
    </p>
  );
}
