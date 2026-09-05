"use client";

import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  Flag,
  FolderOpen,
  Headphones,
  RefreshCw,
  Send,
  ShieldCheck,
  Smile,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { LoadingState, formatStatus } from "../../components/client-ui";
import { apiFetch as fetch } from "../../lib/api-client";
import { documentsPageEnabled } from "../../lib/feature-flags";
import {
  apiUrl,
  caseJourneyStep,
  formatCents,
  nextCaseAction,
  readCaseSummary,
  readJson,
  readList,
  readUser,
  type CaseSummary,
  type User,
} from "../../lib/client-data";
import { priorityCase, recoveryStats } from "../../lib/gamification";

type LoadState = "loading" | "ready" | "offline";
type MetricTone = "mint" | "coral" | "amber" | "rose";

const heroSteps = [
  { number: "1", label: "Facture analysée", tone: "mint" },
  { number: "2", label: "Dossier créé", tone: "amber" },
  { number: "3", label: "Dossier envoyé", tone: "coral" },
] as const;

const progressSteps = [
  {
    title: "Facture analysée",
    description: "Le montant récupérable est identifié.",
  },
  {
    title: "Dossier créé",
    description: "Vos pièces sont réunies et vérifiées.",
  },
  {
    title: "Dossier envoyé",
    description: "La demande est transmise à l’organisme.",
  },
  {
    title: "Remboursement",
    description: "Le montant est versé sur votre compte.",
  },
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoadState("loading");
    try {
      const [sessionResponse, casesResponse] = await Promise.all([
        fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
        fetch(`${apiUrl}/cases`, { credentials: "include" }),
      ]);
      if (sessionResponse.status === 401 || sessionResponse.status === 404) {
        router.replace("/connexion");
        return;
      }

      const [sessionPayload, casesPayload] = await Promise.all([
        readJson(sessionResponse),
        readJson(casesResponse),
      ]);
      const sessionUser = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !casesResponse.ok || !sessionUser) {
        throw new Error("Impossible de charger votre espace.");
      }

      setUser(sessionUser);
      setCases(readList(casesPayload.cases, readCaseSummary));
      setLoadState("ready");
    } catch {
      setLoadState("offline");
    }
  }

  if (loadState === "loading") {
    return <LoadingState label="Ouverture de votre tableau de bord..." />;
  }

  if (loadState === "offline") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#eef5f1] px-5">
        <div className="max-w-md text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#fff0eb] text-[#d75c47]">
            <RefreshCw size={22} />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold text-[#16221d]">
            Le service Lydoc est indisponible.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#66736d]">
            Vérifiez votre connexion, puis relancez le chargement.
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

  const stats = recoveryStats(cases);
  const activeCases = cases.filter(
    (item) => !["REFUNDED", "REJECTED", "CANCELLED"].includes(item.status),
  );
  const sentCases = cases.filter((item) =>
    ["SENT", "REFUNDED"].includes(item.status),
  ).length;
  const attentionCases = cases.filter((item) =>
    ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"].includes(
      item.status,
    ),
  ).length;
  const recentCases = [...cases]
    .sort(
      (left, right) => dateValue(right.createdAt) - dateValue(left.createdAt),
    )
    .slice(0, 5);
  const highlightedCase = priorityCase(cases);

  return (
    <AppShell
      active="dashboard"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="mx-auto w-full max-w-[1340px] px-4 pb-7 pt-4 sm:px-6 lg:px-8 lg:pb-8">
        <header className="mb-3 flex items-center justify-end gap-2 sm:gap-3">
          {documentsPageEnabled ? (
            <a
              href="/documents?new=1"
              className="primary-button min-h-11 w-full px-5 text-sm shadow-[0_10px_24px_rgba(8,122,85,0.18)] sm:w-auto"
            >
              Analyser une facture <Upload size={16} />
            </a>
          ) : null}
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
        </header>

        <section
          aria-labelledby="dashboard-welcome-title"
          className="relative overflow-hidden rounded-[14px] border border-[#efe9df] bg-[#fffcf6] shadow-[0_12px_38px_rgba(61,68,54,0.045)]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 73% 18%, rgba(255,255,255,0.96) 0, rgba(255,255,255,0.48) 25%, transparent 47%), linear-gradient(112deg, #fffaf2 0%, #fffdf9 52%, #fffaf4 100%)",
          }}
        >
          <div className="grid lg:min-h-[220px] lg:grid-cols-[0.9fr_1.45fr] lg:items-stretch">
            <div className="relative z-10 px-6 pb-2 pt-7 sm:px-8 sm:pt-8 lg:flex lg:flex-col lg:justify-center lg:px-10 lg:py-7">
              <h1
                id="dashboard-welcome-title"
                className="max-w-[430px] text-[30px] font-black leading-[1.08] tracking-[-0.025em] text-[#142a22] sm:text-[34px] lg:text-[36px]"
              >
                Bienvenue sur votre{" "}
                <span className="text-[#07865e] underline decoration-[#f1ad2b] decoration-[3px] underline-offset-[5px]">
                  tableau de bord
                </span>
              </h1>
              <p className="mt-5 max-w-[430px] text-sm leading-6 text-[#708078]">
                Lydoc s’occupe de vos démarches.
                <br />
                Suivez l’avancement de vos dossiers en toute simplicité.
              </p>
            </div>

            <div className="relative min-h-[190px] sm:min-h-[220px] lg:min-h-0">
              <Image
                src="/illustrations/dashboard-journey.png"
                alt=""
                width={1891}
                height={832}
                priority
                sizes="(min-width: 1280px) 760px, (min-width: 640px) 720px, 600px"
                className="pointer-events-none absolute left-1/2 top-1/2 h-auto w-[600px] max-w-none -translate-x-1/2 -translate-y-1/2 select-none sm:w-[720px] lg:left-[53%] lg:w-[700px] xl:w-[760px]"
              />
              <ol
                aria-label="Les trois étapes de votre démarche"
                className="absolute left-[23%] right-[20%] top-[37%] grid grid-cols-3 gap-1 before:absolute before:left-[16%] before:right-[16%] before:top-[15px] before:border-t before:border-dashed before:border-[#559381] sm:left-[26%] sm:right-[23%] sm:top-[39%]"
              >
                {heroSteps.map((step) => (
                  <li
                    key={step.number}
                    className="relative z-10 flex min-w-0 flex-col items-center text-center"
                  >
                    <span
                      className={`grid h-[31px] w-[31px] place-items-center rounded-full text-[12px] font-black text-white shadow-[0_4px_12px_rgba(28,71,54,0.11)] ${heroStepTone(step.tone)}`}
                    >
                      {step.number}
                    </span>
                    <span className="mt-2 max-w-[72px] text-[9px] font-bold leading-[1.25] text-[#334a40] sm:text-[10px]">
                      {step.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section
          className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Indicateurs principaux"
        >
          <DashboardMetric
            label="Dossiers en cours"
            value={String(activeCases.length)}
            detail="Voir mes dossiers"
            href="/cases"
            icon={FolderOpen}
            tone="mint"
          />
          <DashboardMetric
            label="Montants identifiés"
            value={formatCents(stats.detectedCents)}
            detail={
              documentsPageEnabled ? "Voir les analyses" : "Voir mes dossiers"
            }
            href={documentsPageEnabled ? "/documents" : "/cases"}
            icon={CircleDollarSign}
            tone="coral"
          />
          <DashboardMetric
            label="Dossiers envoyés"
            value={String(sentCases)}
            detail="Voir l’historique"
            href="/cases"
            icon={Send}
            tone="amber"
          />
          <DashboardMetric
            label="Alertes"
            value={String(attentionCases)}
            detail="Voir les alertes"
            href="/notifications"
            icon={Flag}
            tone="rose"
          />
        </section>

        <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(320px,0.95fr)]">
          <section
            aria-labelledby="recent-cases-title"
            className="overflow-hidden rounded-[12px] border border-[#e1e8e4] bg-white shadow-[0_12px_34px_rgba(27,63,47,0.05)]"
          >
            <div className="flex items-center justify-between gap-4 px-5 pb-3 pt-5 sm:px-6">
              <h2
                id="recent-cases-title"
                className="text-[17px] font-extrabold text-[#1a2822]"
              >
                Mes dossiers récents
              </h2>
              <a
                href="/cases"
                className="group inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-[#087a55] hover:text-[#056846]"
              >
                <span className="hidden sm:inline">Voir tous mes dossiers</span>
                <span className="sm:hidden">Voir tout</span>
                <ArrowRight
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </a>
            </div>

            <div className="mx-3 mb-3 overflow-hidden rounded-[10px] border border-[#e2e9e5] sm:mx-4 sm:mb-4">
              {recentCases.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center px-5 py-8 text-center">
                  <Image
                    src="/illustrations/dashboard-mascot.png"
                    alt="Mascotte Lydoc"
                    width={88}
                    height={94}
                    sizes="88px"
                    className="h-[94px] w-auto object-contain"
                  />
                  <h3 className="mt-2 text-sm font-extrabold text-[#1b2a23]">
                    Aucun dossier pour le moment
                  </h3>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[#738078]">
                    {documentsPageEnabled
                      ? "Analysez une facture pour détecter vos premiers frais remboursables."
                      : "Vos démarches apparaîtront ici dès qu’un dossier sera disponible."}
                  </p>
                  {documentsPageEnabled ? (
                    <a
                      href="/documents?new=1"
                      className="primary-button mt-4 min-h-10 px-4 text-xs"
                    >
                      Analyser une facture <Upload size={14} />
                    </a>
                  ) : null}
                </div>
              ) : (
                <div className="divide-y divide-[#e8eeeb]">
                  {recentCases.map((item) => (
                    <RecentCaseRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </section>

          <CaseProgressPanel item={highlightedCase} />
        </div>

        <ReassuranceStrip />
      </div>
    </AppShell>
  );
}

function DashboardMetric({
  label,
  value,
  detail,
  href,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  tone: MetricTone;
}) {
  const styles: Record<MetricTone, { background: string; color: string }> = {
    mint: { background: "bg-[#dff2e9]", color: "text-[#16865e]" },
    coral: { background: "bg-[#ffede8]", color: "text-[#f06d52]" },
    amber: { background: "bg-[#fff4d6]", color: "text-[#eda10d]" },
    rose: { background: "bg-[#fff0eb]", color: "text-[#e9674d]" },
  };
  const style = styles[tone];

  return (
    <a
      href={href}
      className="group relative min-h-[136px] overflow-hidden rounded-[11px] border border-[#dfe7e3] bg-white p-5 shadow-[0_10px_30px_rgba(27,63,47,0.045)] transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-[#bcd1c7] hover:shadow-[0_14px_34px_rgba(27,63,47,0.08)]"
    >
      <p className="text-xs font-semibold text-[#34433d]">{label}</p>
      <p
        className="mt-2 max-w-[75%] truncate text-[25px] font-black leading-none tracking-[-0.02em] text-[#14221c]"
        title={value}
      >
        {value}
      </p>
      <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-[#087a55]">
        {detail}
        <ArrowRight
          size={13}
          className="transition-transform group-hover:translate-x-0.5"
        />
      </span>
      <span
        aria-hidden="true"
        className={`absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-[9px] ${style.background} ${style.color}`}
      >
        <Icon size={21} strokeWidth={1.8} />
      </span>
    </a>
  );
}

function RecentCaseRow({ item }: { item: CaseSummary }) {
  return (
    <a
      href={`/cases/${item.id}`}
      className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-3 px-4 transition-colors hover:bg-[#f7faf8] sm:grid-cols-[minmax(0,1.6fr)_128px_108px_96px_18px] sm:px-5"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e5f4ec] text-[#087a55]">
          <FileCheck2 size={18} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold text-[#23322b]">
            {item.rule?.name ?? "Dossier de remboursement"}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-[#728078]">
            {item.rule?.organizer ?? "Organisateur à confirmer"}
            <span className="sm:hidden">
              {" "}
              · {formatCents(item.estimatedRecoverableCents)}
            </span>
          </span>
        </span>
      </span>
      <CaseStatus status={item.status} />
      <time
        className="hidden text-xs text-[#65746c] sm:block"
        dateTime={item.createdAt ?? undefined}
      >
        {formatDate(item.createdAt)}
      </time>
      <strong className="hidden text-right text-sm text-[#17251f] sm:block">
        {formatCents(item.estimatedRecoverableCents)}
      </strong>
      <ChevronRight size={17} className="text-[#4d7665]" />
    </a>
  );
}

function CaseProgressPanel({ item }: { item: CaseSummary | null }) {
  if (!item) {
    return (
      <section
        aria-labelledby="case-progress-title"
        className="relative flex min-h-[330px] flex-col overflow-hidden rounded-[12px] border border-[#e1e8e4] bg-white p-6 shadow-[0_12px_34px_rgba(27,63,47,0.05)]"
      >
        <div className="relative z-10 max-w-[62%]">
          <h2
            id="case-progress-title"
            className="text-[17px] font-extrabold text-[#1a2822]"
          >
            Progression d’un dossier
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-[#78847e]">
            Suivez chaque étape, de la facture au versement.
          </p>
          <p className="mt-16 text-sm font-extrabold text-[#1b2a23]">
            Votre parcours commence ici
          </p>
          <p className="mt-1 text-xs leading-5 text-[#738078]">
            Une première analyse suffit pour démarrer votre suivi.
          </p>
        </div>
        <Image
          src="/illustrations/dashboard-mascot.png"
          alt=""
          width={1214}
          height={1295}
          sizes="280px"
          className="pointer-events-none absolute -bottom-2 -right-3 h-auto w-[280px] max-w-none select-none"
        />
      </section>
    );
  }

  const completedSteps = completedDashboardSteps(item);

  return (
    <section
      aria-labelledby="case-progress-title"
      className="relative flex min-h-[330px] flex-col overflow-hidden rounded-[12px] border border-[#e1e8e4] bg-white p-5 shadow-[0_12px_34px_rgba(27,63,47,0.05)] sm:p-6"
    >
      <div className="relative z-10">
        <h2
          id="case-progress-title"
          className="text-[17px] font-extrabold text-[#1a2822]"
        >
          Progression d’un dossier
        </h2>
        <p className="mt-1 text-[11px] leading-5 text-[#78847e]">
          Suivez chaque étape, de la facture au versement.
        </p>
      </div>

      <ol
        className="relative z-10 mt-4 max-w-[68%] flex-1"
        aria-label="Avancement du dossier sélectionné"
      >
        {progressSteps.map((step, index) => {
          const stepNumber = index + 1;
          const complete = stepNumber <= completedSteps;
          const current = stepNumber === completedSteps + 1;
          const connectorComplete = stepNumber < completedSteps;

          return (
            <li
              key={step.title}
              aria-current={current ? "step" : undefined}
              className="relative flex gap-3 pb-3 last:pb-0"
            >
              {index < progressSteps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-0 left-[13px] top-7 w-px ${
                    connectorComplete ? "bg-[#2a9b73]" : "bg-[#dce7e1]"
                  }`}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                  complete
                    ? "bg-[#0d8c62] text-white"
                    : current
                      ? "border-2 border-[#0d8c62] bg-white text-[#0d8c62]"
                      : "border border-[#d7e2dc] bg-[#f5f8f6] text-[#8c9992]"
                }`}
              >
                {complete ? <Check size={14} strokeWidth={3} /> : stepNumber}
              </span>
              <span className="min-w-0 pt-0.5">
                <span
                  className={`block text-xs font-bold ${
                    complete || current ? "text-[#26362f]" : "text-[#8a9690]"
                  }`}
                >
                  {step.title}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-[#7b8982]">
                  {index === 0 && item.createdAt
                    ? formatDate(item.createdAt)
                    : step.description}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <a
        href={`/cases/${item.id}`}
        className="group relative z-10 mt-3 inline-flex max-w-[68%] items-center gap-1.5 self-start text-[11px] font-extrabold text-[#087a55] hover:text-[#056846]"
      >
        {nextCaseAction(item)}
        <ArrowRight
          size={13}
          className="transition-transform group-hover:translate-x-0.5"
        />
      </a>
      <Image
        src="/illustrations/dashboard-mascot.png"
        alt=""
        width={1214}
        height={1295}
        sizes="280px"
        className="pointer-events-none absolute -bottom-2 -right-3 hidden h-auto w-[280px] max-w-none select-none sm:block"
      />
    </section>
  );
}

function ReassuranceStrip() {
  const items = [
    {
      title: "Sécurisé",
      description:
        "Vos documents sont protégés et traités en toute confidentialité.",
      icon: ShieldCheck,
    },
    {
      title: "Simple",
      description: "Lydoc s’occupe des formalités, à chaque étape.",
      icon: Smile,
    },
    {
      title: "Accompagné",
      description: "Notre équipe reste disponible quand vous en avez besoin.",
      icon: Headphones,
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

function CaseStatus({ status }: { status: string }) {
  const success = [
    "SENT",
    "REFUNDED",
    "GENERATED",
    "PAID",
    "PRINT_READY",
  ].includes(status);
  const ready = status === "READY_TO_PAY";
  const error = ["REJECTED", "CANCELLED"].includes(status);
  const classes = error
    ? "bg-[#fff0eb] text-[#bd4e39]"
    : success
      ? "bg-[#e7f5ee] text-[#087a55]"
      : ready
        ? "bg-[#fff4d9] text-[#a56809]"
        : "bg-[#eef4f1] text-[#527064]";

  return (
    <span
      className={`inline-flex min-h-7 items-center justify-center whitespace-nowrap rounded-full px-3 text-[10px] font-bold ${classes}`}
    >
      {formatStatus(status)}
    </span>
  );
}

function heroStepTone(tone: (typeof heroSteps)[number]["tone"]): string {
  if (tone === "amber") return "bg-[#f2ad27]";
  if (tone === "coral") return "bg-[#ff7357]";
  return "bg-[#07865e]";
}

function completedDashboardSteps(item: CaseSummary): number {
  if (item.status === "REFUNDED") return 4;
  if (item.status === "SENT") return 3;
  return caseJourneyStep(item) >= 2 ? 2 : 1;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
