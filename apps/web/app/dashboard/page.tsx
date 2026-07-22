"use client";

import { ArrowRight, CheckCircle2, FileSearch, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { JourneySteps, LoadingState } from "../../components/client-ui";
import {
  apiUrl,
  caseJourneyStep,
  formatCents,
  isFinishedCase,
  readCaseSummary,
  readDocument,
  readJson,
  readList,
  readUser,
  type CaseSummary,
  type UploadedDocument,
  type User,
} from "../../lib/client-data";

type LoadState = "loading" | "ready" | "offline";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoadState("loading");
    try {
      const [sessionResponse, documentsResponse, casesResponse] =
        await Promise.all([
          fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
          fetch(`${apiUrl}/documents`, { credentials: "include" }),
          fetch(`${apiUrl}/cases`, { credentials: "include" }),
        ]);
      if (sessionResponse.status === 401 || sessionResponse.status === 404) {
        router.replace("/connexion");
        return;
      }

      const [sessionPayload, documentsPayload, casesPayload] =
        await Promise.all([
          readJson(sessionResponse),
          readJson(documentsResponse),
          readJson(casesResponse),
        ]);
      const sessionUser = readUser(sessionPayload.user);
      if (
        !sessionResponse.ok ||
        !documentsResponse.ok ||
        !casesResponse.ok ||
        !sessionUser
      ) {
        throw new Error("Impossible de charger votre espace.");
      }

      setUser(sessionUser);
      setDocuments(readList(documentsPayload.documents, readDocument));
      setCases(readList(casesPayload.cases, readCaseSummary));
      setLoadState("ready");
    } catch {
      setLoadState("offline");
    }
  }

  if (loadState === "loading")
    return <LoadingState label="Ouverture de votre espace..." />;

  if (loadState === "offline") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fbfcfe] px-5">
        <div className="max-w-md text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#fff0ec] text-[#c6503a]">
            <RefreshCw size={22} />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold text-[#102544]">
            Le service Lydoc est indisponible.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#667189]">
            Vérifiez que l’API est démarrée, puis relancez le chargement.
          </p>
          <button
            type="button"
            onClick={loadDashboard}
            className="primary-button mt-6"
          >
            <RefreshCw size={17} /> Réessayer
          </button>
        </div>
      </div>
    );
  }

  const activeCases = cases.filter((item) => !isFinishedCase(item));
  const primaryCase = activeCases[0] ?? cases[0] ?? null;
  const recoverableCents = activeCases.reduce(
    (total, item) => total + item.estimatedRecoverableCents,
    0,
  );
  const refundedCents = cases
    .filter((item) => item.status === "REFUNDED")
    .reduce((total, item) => total + item.estimatedRecoverableCents, 0);
  const presentation = dashboardPresentation(primaryCase);
  const firstName = user?.email.split("@")[0]?.split(/[._-]/)[0] ?? "vous";

  return (
    <AppShell
      active="dashboard"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="page-container max-w-[1120px] py-10 sm:py-14">
        <header>
          <p className="text-sm font-semibold capitalize text-[#667189]">
            Bonjour {firstName}
          </p>
          <h1 className="mt-2 text-3xl font-extrabold text-[#101a34] sm:text-4xl">
            Voici l’essentiel.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667189]">
            Lydoc vous montre uniquement ce qui mérite votre attention
            maintenant.
          </p>
        </header>

        <section
          className="surface mt-9 overflow-hidden"
          aria-label="Prochaine étape"
        >
          <div className="px-5 py-8 text-center sm:px-10 sm:py-10">
            <span
              className={`mx-auto grid h-11 w-11 place-items-center rounded-full ${primaryCase ? "bg-[#eaf8f1] text-[#16875b]" : "bg-[#edf2ff] text-[#2457f5]"}`}
            >
              {primaryCase ? (
                <CheckCircle2 size={22} />
              ) : (
                <FileSearch size={21} />
              )}
            </span>
            <p className="mt-4 text-xs font-extrabold uppercase text-[#6f7b92]">
              {presentation.eyebrow}
            </p>
            <h2 className="mx-auto mt-3 max-w-3xl text-2xl font-extrabold text-[#101a34] sm:text-3xl">
              {presentation.title}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[#667189]">
              {presentation.description}
            </p>
          </div>

          {primaryCase ? (
            <div className="border-t border-[#e2e7ee] px-5 py-7 sm:px-10">
              <JourneySteps current={caseJourneyStep(primaryCase)} />
            </div>
          ) : null}

          <div className="border-t border-[#e2e7ee] px-5 py-8 text-center sm:px-10">
            {primaryCase ? (
              <>
                <p className="text-sm font-semibold text-[#667189]">
                  {primaryCase.rule?.name ?? "Dossier de remboursement"} ·{" "}
                  {formatCents(primaryCase.estimatedRecoverableCents)}
                </p>
                <h3 className="mt-2 text-xl font-extrabold text-[#101a34]">
                  {presentation.question}
                </h3>
              </>
            ) : (
              <h3 className="text-xl font-extrabold text-[#101a34]">
                Prêt à vérifier votre première facture ?
              </h3>
            )}
            <a
              href={presentation.href}
              className="primary-button mt-6 min-w-[220px]"
            >
              {presentation.action} <ArrowRight size={17} />
            </a>
          </div>

          <div className="grid border-t border-[#e2e7ee] sm:grid-cols-3 sm:divide-x sm:divide-[#e2e7ee]">
            <Summary value={formatCents(recoverableCents)} label="identifiés" />
            <Summary
              value={String(activeCases.length)}
              label={
                activeCases.length > 1
                  ? "dossiers en cours"
                  : "dossier en cours"
              }
            />
            <Summary
              value={formatCents(refundedCents)}
              label="déjà reçus"
              positive={refundedCents > 0}
            />
          </div>
        </section>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 text-sm sm:flex-row sm:gap-7">
          <a
            href="/cases"
            className="font-extrabold text-[#2457f5] hover:text-[#1947d8]"
          >
            Voir mes dossiers
          </a>
          <span className="hidden h-1 w-1 rounded-full bg-[#b8c1cf] sm:block" />
          <a
            href="/documents"
            className="font-semibold text-[#667189] hover:text-[#2457f5]"
          >
            Consulter mes {documents.length} document
            {documents.length > 1 ? "s" : ""}
          </a>
        </div>
      </div>
    </AppShell>
  );
}

function Summary({
  value,
  label,
  positive = false,
}: {
  value: string;
  label: string;
  positive?: boolean;
}) {
  return (
    <div className="px-5 py-5 text-center sm:py-6">
      <p
        className={`text-xl font-extrabold ${positive ? "text-[#16875b]" : "text-[#101a34]"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-semibold text-[#7a8499]">{label}</p>
    </div>
  );
}

function dashboardPresentation(item: CaseSummary | null) {
  if (!item) {
    return {
      eyebrow: "Commencer",
      title: "Une facture suffit pour savoir.",
      description:
        "Importez votre facture opérateur. L’analyse est gratuite et ne vous engage à rien.",
      question: "",
      action: "Analyser une facture",
      href: "/documents?new=1",
    };
  }
  if (item.status === "REFUNDED") {
    return {
      eyebrow: "Remboursement reçu",
      title: "Votre remboursement est arrivé.",
      description:
        "Ce dossier est terminé. Vous pouvez retrouver son historique à tout moment.",
      question: "Consulter le dossier terminé",
      action: "Voir le dossier",
      href: `/cases/${item.id}`,
    };
  }
  if (item.fulfillmentMode === "SELF_SERVICE") {
    return {
      eyebrow: "Dossier complet",
      title: "Votre dossier gratuit est prêt.",
      description:
        "Téléchargez le PDF complet, imprimez-le puis envoyez-le à l’organisateur.",
      question: "Télécharger maintenant ?",
      action: "Ouvrir mon dossier",
      href: `/cases/${item.id}`,
    };
  }
  if (item.fulfillmentMode === "MANAGED_POSTAL") {
    return {
      eyebrow: "Envoi pris en charge",
      title: "Lydoc s’occupe de votre courrier.",
      description:
        "Retrouvez l’impression, l’acheminement et le suivi postal au même endroit.",
      question: "Voir où en est l’envoi",
      action: "Suivre mon dossier",
      href: `/cases/${item.id}`,
    };
  }
  if (item.status === "WAITING_FOR_USER_DOCUMENTS") {
    return {
      eyebrow: "Action requise",
      title: "Une pièce suffit pour avancer.",
      description:
        "Le règlement a été lu. Lydoc vous demande uniquement les justificatifs réellement nécessaires.",
      question: "Compléter le dossier maintenant ?",
      action: "Ajouter la pièce",
      href: `/cases/${item.id}`,
    };
  }
  if (item.status === "READY_TO_PAY") {
    return {
      eyebrow: "Dossier prêt",
      title: "Votre demande est presque terminée.",
      description:
        "Vérifiez les informations puis choisissez entre le téléchargement gratuit et l’envoi pris en charge.",
      question: "Comment souhaitez-vous poursuivre ?",
      action: "Faire mon choix",
      href: `/cases/${item.id}`,
    };
  }
  return {
    eyebrow: "Remboursement détecté",
    title: "Nous avons trouvé une demande possible.",
    description:
      "Le règlement correspondant est identifié. Lancez la préparation pour connaître les pièces utiles.",
    question: "Préparer le dossier maintenant ?",
    action: "Commencer mon dossier",
    href: `/cases/${item.id}`,
  };
}
