"use client";

import {
  ArrowRight,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  Flag,
  FolderOpen,
  RefreshCw,
  Send,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { LoadingState, formatStatus } from "../../components/client-ui";
import { apiFetch as fetch } from "../../lib/api-client";
import {
  apiUrl,
  formatCents,
  readCaseSummary,
  readJson,
  readList,
  readUser,
  type CaseSummary,
  type User,
} from "../../lib/client-data";
import { recoveryStats } from "../../lib/gamification";

type LoadState = "loading" | "ready" | "offline";
type MetricTone = "mint" | "coral" | "amber" | "rose";

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
      if (
        !sessionResponse.ok ||
        !casesResponse.ok ||
        !sessionUser
      ) {
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
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-[#fff0eb] text-[#d75c47]">
            <RefreshCw size={22} />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold text-[#16221d]">
            Le service Lydoc est indisponible.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#66736d]">
            Vérifiez que l’API est démarrée, puis relancez le chargement.
          </p>
          <button type="button" onClick={loadDashboard} className="primary-button mt-6">
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
    ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"].includes(item.status),
  ).length;
  const recentCases = [...cases]
    .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt))
    .slice(0, 5);

  return (
    <AppShell active="dashboard" email={user?.email} isAdmin={user?.role === "ADMIN"}>
      <div className="mx-auto w-full max-w-[1220px] px-4 py-7 sm:px-7 lg:px-8 lg:py-8">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-[26px] font-extrabold text-[#16221d] sm:text-[30px]">
              Tableau de bord
            </h1>
            <p className="mt-1 text-sm text-[#68756f]">
              Voici l’avancement de vos dossiers.
            </p>
          </div>
          <a href="/documents?new=1" className="primary-button min-h-11 self-start px-5 sm:self-auto">
            Analyser une facture <Upload size={16} />
          </a>
        </header>

        <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicateurs principaux">
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
            detail="Voir les analyses"
            href="/documents"
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
            label="À surveiller"
            value={String(attentionCases)}
            detail="Voir les alertes"
            href="/notifications"
            icon={Flag}
            tone="rose"
          />
        </section>

        <section className="mt-8" aria-labelledby="recent-cases-title">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="recent-cases-title" className="text-lg font-extrabold text-[#1a2822]">
              Mes dossiers récents
            </h2>
            <a href="/cases" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#087a55] hover:text-[#056846]">
              Voir tous mes dossiers <ArrowRight size={14} />
            </a>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#dfe8e3] bg-white shadow-[0_12px_36px_rgba(27,63,47,0.05)]">
            {recentCases.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#e7f5ee] text-[#087a55]">
                  <FileCheck2 size={21} />
                </span>
                <h3 className="mt-4 text-sm font-extrabold text-[#1b2a23]">Aucun dossier pour le moment</h3>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[#738078]">
                  Analysez une facture pour détecter vos premiers frais remboursables.
                </p>
                <a href="/documents?new=1" className="primary-button mt-5 min-h-10 px-4 text-xs">
                  Analyser une facture <Upload size={14} />
                </a>
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
    mint: { background: "bg-[#ddf1e7]", color: "text-[#16865e]" },
    coral: { background: "bg-[#ffede8]", color: "text-[#f06d52]" },
    amber: { background: "bg-[#fff5da]", color: "text-[#f0a600]" },
    rose: { background: "bg-[#fff0eb]", color: "text-[#e9674d]" },
  };
  const style = styles[tone];

  return (
    <a
      href={href}
      className="group relative min-h-[132px] overflow-hidden rounded-lg border border-[#dfe8e3] bg-white p-4 shadow-[0_10px_30px_rgba(27,63,47,0.045)] transition-transform hover:-translate-y-0.5 hover:border-[#bcd1c7]"
    >
      <p className="text-xs font-semibold text-[#26352e]">{label}</p>
      <p className="mt-2 max-w-[75%] truncate text-[24px] font-extrabold leading-none text-[#14221c]" title={value}>
        {value}
      </p>
      <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-[#087a55]">
        {detail} <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
      <span className={`absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-lg ${style.background} ${style.color}`}>
        <Icon size={22} strokeWidth={1.8} />
      </span>
    </a>
  );
}

function RecentCaseRow({ item }: { item: CaseSummary }) {
  return (
    <a
      href={`/cases/${item.id}`}
      className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-3 px-4 transition-colors hover:bg-[#f7faf8] sm:grid-cols-[minmax(0,1.6fr)_132px_112px_110px_18px] sm:px-5"
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
            <span className="sm:hidden"> · {formatCents(item.estimatedRecoverableCents)}</span>
          </span>
        </span>
      </span>
      <CaseStatus status={item.status} />
      <time className="hidden text-xs text-[#65746c] sm:block" dateTime={item.createdAt ?? undefined}>
        {formatDate(item.createdAt)}
      </time>
      <strong className="hidden text-right text-sm text-[#17251f] sm:block">
        {formatCents(item.estimatedRecoverableCents)}
      </strong>
      <ChevronRight size={17} className="text-[#4d7665]" />
    </a>
  );
}

function CaseStatus({ status }: { status: string }) {
  const success = ["SENT", "REFUNDED", "GENERATED", "PAID", "PRINT_READY"].includes(status);
  const ready = ["READY_TO_PAY"].includes(status);
  const error = ["REJECTED", "CANCELLED"].includes(status);
  const classes = error
    ? "bg-[#fff0eb] text-[#bd4e39]"
    : success
      ? "bg-[#e7f5ee] text-[#087a55]"
      : ready
        ? "bg-[#fff4d9] text-[#a56809]"
        : "bg-[#eef4f1] text-[#527064]";

  return (
    <span className={`inline-flex min-h-7 items-center justify-center whitespace-nowrap rounded-full px-3 text-[10px] font-bold ${classes}`}>
      {formatStatus(status)}
    </span>
  );
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
