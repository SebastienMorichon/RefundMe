"use client";

import { ArrowRight, FolderKanban, Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { LoadingState, Notice, StatusBadge } from "../../components/client-ui";
import {
  apiUrl,
  caseProgress,
  formatCents,
  formatDate,
  isFinishedCase,
  nextCaseAction,
  readCaseSummary,
  readJson,
  readList,
  readUser,
  type CaseSummary,
  type User,
} from "../../lib/client-data";

type Filter = "active" | "finished";

export default function CasesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadCases();
  }, []);

  async function loadCases() {
    setLoading(true);
    setError("");
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
      if (!sessionResponse.ok || !casesResponse.ok || !sessionUser)
        throw new Error("Impossible de charger vos dossiers.");
      setUser(sessionUser);
      setCases(readList(casesPayload.cases, readCaseSummary));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Le service Lydoc est indisponible.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <LoadingState label="Chargement de vos dossiers..." />;

  const activeCases = cases.filter((item) => !isFinishedCase(item));
  const finishedCases = cases.filter(isFinishedCase);
  const visibleCases = filter === "active" ? activeCases : finishedCases;

  return (
    <AppShell
      active="cases"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="page-container max-w-[1120px] py-9 sm:py-12">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase text-[#6f7b92]">
              Vos remboursements
            </p>
            <h1 className="mt-2 text-3xl font-extrabold text-[#101a34] sm:text-4xl">
              Mes dossiers
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#667189]">
              Suivez simplement ce qu’il reste à faire.
            </p>
          </div>
          <a
            href="/documents?new=1"
            className="secondary-button self-start sm:self-auto"
          >
            <Plus size={17} /> Nouveau dossier
          </a>
        </header>

        {error ? (
          <div className="mt-6">
            <Notice tone="error">
              {error}{" "}
              <button
                type="button"
                onClick={loadCases}
                className="ml-2 inline-flex items-center gap-1 font-extrabold underline"
              >
                <RefreshCw size={13} /> Réessayer
              </button>
            </Notice>
          </div>
        ) : null}

        <div
          className="mt-8 inline-flex rounded-md border border-[#d7dfe9] bg-white p-1"
          role="tablist"
          aria-label="Filtrer les dossiers"
        >
          <FilterButton
            active={filter === "active"}
            onClick={() => setFilter("active")}
            label="En cours"
            count={activeCases.length}
          />
          <FilterButton
            active={filter === "finished"}
            onClick={() => setFilter("finished")}
            label="Terminés"
            count={finishedCases.length}
          />
        </div>

        <section className="surface mt-5 overflow-hidden" aria-live="polite">
          {visibleCases.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <FolderKanban className="mx-auto text-[#9aa5b8]" size={28} />
              <h2 className="mt-4 text-lg font-extrabold text-[#101a34]">
                {filter === "active"
                  ? "Aucun dossier en cours"
                  : "Aucun dossier terminé"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#667189]">
                {filter === "active"
                  ? "Analysez une facture pour rechercher un remboursement possible."
                  : "Vos remboursements terminés apparaîtront ici."}
              </p>
              {filter === "active" ? (
                <a href="/documents?new=1" className="primary-button mt-6">
                  Analyser une facture <ArrowRight size={17} />
                </a>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-[#e3e8ef]">
              {visibleCases.map((item) => (
                <CaseRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>

        {visibleCases.length > 0 ? (
          <p className="mt-6 text-center text-xs text-[#7a8499]">
            Les dossiers qui demandent une action apparaissent en premier.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-extrabold ${active ? "bg-[#eef3ff] text-[#2457f5]" : "text-[#667189] hover:text-[#2457f5]"}`}
    >
      {label}
      <span
        className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] ${active ? "bg-[#2457f5] text-white" : "bg-[#edf1f6] text-[#667189]"}`}
      >
        {count}
      </span>
    </button>
  );
}

function CaseRow({ item }: { item: CaseSummary }) {
  const progress = caseProgress(item);
  const finished = isFinishedCase(item);

  return (
    <article className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(190px,1.1fr)_110px_minmax(230px,1fr)_150px] lg:items-center">
      <div className="min-w-0">
        <h2 className="truncate text-base font-extrabold text-[#17213b]">
          {item.rule?.name ?? "Dossier de remboursement"}
        </h2>
        <p className="mt-1 text-xs text-[#7a8499]">
          {item.rule?.organizer ?? "Organisateur"}
          {item.createdAt ? ` · créé le ${formatDate(item.createdAt)}` : ""}
        </p>
      </div>
      <p className="text-lg font-extrabold text-[#101a34]">
        {formatCents(item.estimatedRecoverableCents)}
      </p>
      <div>
        {finished ? (
          <StatusBadge status={item.status} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 text-xs font-bold text-[#536078]">
              <span>{nextCaseAction(item)}</span>
              <span>{progress} %</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e5eaf1]">
              <div
                className="h-full rounded-full bg-[#2457f5]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        )}
      </div>
      <a
        href={`/cases/${item.id}`}
        className="inline-flex items-center justify-start gap-2 text-sm font-extrabold text-[#2457f5] hover:text-[#1947d8] lg:justify-end"
      >
        {finished ? "Voir" : nextCaseAction(item)} <ArrowRight size={16} />
      </a>
    </article>
  );
}
