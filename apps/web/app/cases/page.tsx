"use client";

import {
  ArrowRight,
  FolderKanban,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { PageHeading } from "../../components/cockpit-ui";
import { LoadingState, Notice, StatusBadge } from "../../components/client-ui";
import { apiFetch as fetch } from "../../lib/api-client";
import { reimbursementCreationEnabled } from "../../lib/feature-flags";
import {
  apiUrl,
  caseProgress,
  formatCents,
  formatDate,
  nextCaseAction,
  readCaseSummary,
  readJson,
  readList,
  readUser,
  type CaseSummary,
  type User,
} from "../../lib/client-data";

type Filter = "all" | "action" | "sent" | "refunded";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "action", label: "À compléter" },
  { id: "sent", label: "Envoyés" },
  { id: "refunded", label: "Remboursés" },
];

export default function CasesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const filterTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  const visibleCases = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("fr");
    return cases.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.rule?.name.toLocaleLowerCase("fr").includes(normalizedSearch) ||
        item.rule?.organizer.toLocaleLowerCase("fr").includes(normalizedSearch);
      return matchesSearch && matchesFilter(item, filter);
    });
  }, [cases, filter, search]);

  function handleFilterKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % filters.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + filters.length) % filters.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = filters.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const nextFilter = filters[nextIndex];
    if (!nextFilter) return;
    setFilter(nextFilter.id);
    filterTabRefs.current[nextIndex]?.focus();
  }

  if (loading) return <LoadingState label="Chargement de vos dossiers..." />;

  return (
    <AppShell
      active="cases"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="page-container py-7 sm:py-9">
        <PageHeading
          eyebrow="Remboursement des SMS surtaxés"
          title="Mes dossiers de remboursement SMS+"
          description="Suivez chaque jeu-concours, les SMS+ détectés sur votre facture mobile, la prochaine action et le montant estimatif récupérable."
          action={
            reimbursementCreationEnabled ? (
              <a
                href="/documents?new=1"
                className="primary-button min-h-10 self-start px-4 text-xs sm:self-auto"
              >
                <Plus size={15} /> Nouveau remboursement
              </a>
            ) : undefined
          }
        />

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

        <section className="surface mt-6 overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-[#e3e9e6] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div
              className="grid grid-cols-2 gap-1 sm:flex"
              role="tablist"
              aria-label="Filtrer les dossiers"
            >
              {filters.map((item, index) => (
                <button
                  key={item.id}
                  id={`case-filter-${item.id}`}
                  ref={(element) => {
                    filterTabRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  onKeyDown={(event) => handleFilterKeyDown(event, index)}
                  role="tab"
                  aria-selected={filter === item.id}
                  aria-controls="case-filter-panel"
                  tabIndex={filter === item.id ? 0 : -1}
                  className={`min-h-9 w-full rounded-md px-3 text-xs font-extrabold transition-colors sm:w-auto ${
                    filter === item.id
                      ? "bg-[#087a55] text-white"
                      : "text-[#66736d] hover:bg-[#f0f4f2] hover:text-[#24332c]"
                  }`}
                >
                  {item.label}
                  <span className="ml-1.5 opacity-70">
                    {
                      cases.filter((caseItem) =>
                        matchesFilter(caseItem, item.id),
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
            <label className="relative block w-full lg:w-[250px]">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7e8a84]"
              />
              <span className="sr-only">
                Rechercher un jeu-concours ou un organisateur
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher un jeu ou un organisateur"
                className="h-9 w-full rounded-md border border-[#d5dfda] bg-white pl-9 pr-3 text-xs text-[#24332c] outline-none transition-colors placeholder:text-[#929d97] focus:border-[#087a55]"
              />
            </label>
          </div>

          <div
            id="case-filter-panel"
            role="tabpanel"
            aria-labelledby={`case-filter-${filter}`}
            tabIndex={0}
          >
            {visibleCases.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <FolderKanban className="mx-auto text-[#99a59f]" size={28} />
                <h2 className="mt-4 text-lg font-extrabold text-[#24332c]">
                  Aucun dossier de remboursement dans cette vue
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#66736d]">
                  {cases.length === 0
                    ? reimbursementCreationEnabled
                      ? "Analysez une facture mobile pour rechercher des SMS+ de jeux-concours potentiellement remboursables."
                      : "Vos demandes de remboursement SMS+ apparaîtront ici dès qu’un dossier sera disponible."
                    : "Modifiez le filtre ou la recherche pour retrouver un dossier."}
                </p>
                {cases.length === 0 && reimbursementCreationEnabled ? (
                  <a href="/documents?new=1" className="primary-button mt-6">
                    Nouveau remboursement <ArrowRight size={17} />
                  </a>
                ) : null}
              </div>
            ) : (
              <>
                <div className="hidden lg:block">
                  <div className="grid grid-cols-[minmax(180px,1.1fr)_170px_minmax(190px,1fr)_130px_125px_36px] gap-5 bg-[#f8faf9] px-5 py-3 text-[10px] font-extrabold uppercase text-[#849089]">
                    <span>Dossier SMS+</span>
                    <span>Progression</span>
                    <span>Prochaine action</span>
                    <span>Montant estimatif</span>
                    <span>Statut</span>
                    <span />
                  </div>
                  <div className="divide-y divide-[#e7ece9]">
                    {visibleCases.map((item) => (
                      <CaseTableRow key={item.id} item={item} />
                    ))}
                  </div>
                </div>
                <div className="divide-y divide-[#e7ece9] lg:hidden">
                  {visibleCases.map((item) => (
                    <CaseMobileRow key={item.id} item={item} />
                  ))}
                </div>
              </>
            )}

            {visibleCases.length > 0 ? (
              <div className="border-t border-[#e3e9e6] bg-[#fbfcfb] px-5 py-3 text-right text-[11px] text-[#7b8781]">
                {visibleCases.length} dossier de remboursement
                {visibleCases.length > 1 ? "s" : ""} affiché
                {visibleCases.length > 1 ? "s" : ""}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function CaseTableRow({ item }: { item: CaseSummary }) {
  const progress = caseProgress(item);
  return (
    <a
      href={`/cases/${item.id}`}
      className="grid grid-cols-[minmax(180px,1.1fr)_170px_minmax(190px,1fr)_130px_125px_36px] items-center gap-5 px-5 py-4 transition-colors hover:bg-[#f8faf9]"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-extrabold text-[#24332c]">
          {item.rule?.name ?? "Dossier de remboursement SMS+"}
        </span>
        <span className="mt-1 block truncate text-[11px] text-[#7b8781]">
          {item.rule?.organizer ?? "Organisateur"}
          {item.createdAt ? ` · ${formatDate(item.createdAt)}` : ""}
        </span>
      </span>
      <span>
        <span className="flex items-center justify-between text-[11px] font-bold text-[#59665f]">
          <span>{progress} %</span>
          <span>{progressLabel(progress)}</span>
        </span>
        <span className="mt-2 block h-1.5 overflow-hidden rounded-sm bg-[#e4eae7]">
          <span
            className="block h-full rounded-sm bg-[#087a55]"
            style={{ width: `${progress}%` }}
          />
        </span>
      </span>
      <span className="text-xs font-semibold leading-5 text-[#59665f]">
        {nextCaseAction(item)}
      </span>
      <span className="text-sm font-extrabold text-[#24332c]">
        {formatCents(item.estimatedRecoverableCents)}
      </span>
      <span>
        <StatusBadge status={item.status} />
      </span>
      <ArrowRight size={16} className="text-[#087a55]" />
    </a>
  );
}

function CaseMobileRow({ item }: { item: CaseSummary }) {
  const progress = caseProgress(item);
  return (
    <a
      href={`/cases/${item.id}`}
      className="block px-5 py-5 transition-colors hover:bg-[#f8faf9]"
    >
      <span className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block truncate text-sm font-extrabold text-[#24332c]">
            {item.rule?.name ?? "Dossier de remboursement SMS+"}
          </span>
          <span className="mt-1 block text-xs text-[#7b8781]">
            {item.rule?.organizer ?? "Organisateur"}
          </span>
        </span>
        <span className="shrink-0 text-sm font-extrabold text-[#24332c]">
          {formatCents(item.estimatedRecoverableCents)}
        </span>
      </span>
      <span className="mt-4 flex items-center justify-between text-xs font-bold text-[#59665f]">
        <span>{nextCaseAction(item)}</span>
        <span className="text-[#087a55]">{progress} %</span>
      </span>
      <span className="mt-2 block h-1.5 overflow-hidden rounded-sm bg-[#e4eae7]">
        <span
          className="block h-full rounded-sm bg-[#087a55]"
          style={{ width: `${progress}%` }}
        />
      </span>
      <span className="mt-4 flex items-center justify-between">
        <StatusBadge status={item.status} />
        <ArrowRight size={16} className="text-[#087a55]" />
      </span>
    </a>
  );
}

function matchesFilter(item: CaseSummary, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "refunded") return item.status === "REFUNDED";
  if (filter === "sent")
    return (
      item.status !== "REFUNDED" &&
      (item.fulfillmentMode !== null ||
        ["PAID", "PRINT_READY", "SENT"].includes(item.status))
    );
  return (
    item.status !== "REFUNDED" &&
    item.fulfillmentMode === null &&
    ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"].includes(
      item.status,
    )
  );
}

function progressLabel(progress: number): string {
  if (progress >= 100) return "Terminé";
  if (progress >= 80) return "En traitement";
  if (progress >= 60) return "Prêt";
  if (progress >= 40) return "À compléter";
  return "Détecté";
}
