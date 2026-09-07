"use client";

import {
  Activity,
  BadgeEuro,
  CheckCircle2,
  Files,
  LoaderCircle,
  RefreshCw,
  Search,
  UserCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { LoadingState, Notice } from "../../../components/client-ui";
import { apiFetch as fetch } from "../../../lib/api-client";
import {
  apiUrl,
  errorMessage,
  formatCents,
  readJson,
  readUser,
  type User,
} from "../../../lib/client-data";

type ClientFilter =
  "all" | "online" | "offline" | "unverified" | "with_cases" | "refunded";

type AdminClient = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  isOnline: boolean;
  activeSessionCount: number;
  lastActivityAt: string | null;
  caseCount: number;
  activeCaseCount: number;
  refundedCaseCount: number;
  estimatedRecoverableCents: number;
  estimatedRefundedCents: number;
  averageEstimatedRefundedCents: number | null;
};

type AdminClientsOverview = {
  generatedAt: string;
  onlineWindowMinutes: number;
  stats: {
    registeredClients: number;
    verifiedClients: number;
    onlineClients: number;
    totalCases: number;
    activeCases: number;
    refundedCases: number;
    estimatedRecoverableCents: number;
    estimatedRefundedCents: number;
    averageEstimatedRefundedCents: number | null;
  };
  clients: AdminClient[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const pageSize = 25;

export default function AdminClientsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [overview, setOverview] = useState<AdminClientsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ClientFilter>("all");
  const [page, setPage] = useState(1);
  const latestRequest = useRef(0);

  const loadPage = useCallback(
    async (background = false) => {
      const requestId = latestRequest.current + 1;
      latestRequest.current = requestId;
      if (background) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const sessionResponse = await fetch(`${apiUrl}/auth/me`, {
          credentials: "include",
          cache: "no-store",
        });
        const sessionPayload = await readJson(sessionResponse);
        const sessionUser = readUser(sessionPayload.user);
        if (!sessionResponse.ok || !sessionUser) {
          window.location.assign("/connexion");
          return;
        }
        if (latestRequest.current !== requestId) return;
        setUser(sessionUser);

        if (sessionUser.role !== "ADMIN") {
          setOverview(null);
          setError("Ce compte n’a pas les droits administrateur.");
          return;
        }

        const response = await fetch(`${apiUrl}/admin/clients/search`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page, limit: pageSize, search, filter }),
        });
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(
            errorMessage(payload, "Impossible de charger les clients."),
          );
        }
        const parsed = readOverview(payload);
        if (!parsed) {
          throw new Error("La réponse clients reçue est invalide.");
        }
        if (latestRequest.current !== requestId) return;
        setOverview(parsed);
      } catch (caught) {
        if (latestRequest.current !== requestId) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "L’API Lydoc est indisponible.",
        );
      } finally {
        if (latestRequest.current === requestId) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [filter, page, search],
  );

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadPage(true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadPage]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchInput.trim();
    setPage(1);
    if (nextSearch === search) void loadPage(true);
    else setSearch(nextSearch);
  }

  const pendingVerification = overview
    ? Math.max(
        0,
        overview.stats.registeredClients - overview.stats.verifiedClients,
      )
    : 0;

  return (
    <AppShell
      active="admin-clients"
      email={user?.email}
      isAdmin={user?.role === "ADMIN"}
    >
      <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase text-[#7b8781]">
              Administration
            </p>
            <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">
              Clients et remboursements
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66736d]">
              Suivez les inscriptions, l’activité récente et les résultats des
              dossiers de remboursement de SMS surtaxés.
            </p>
          </div>
          {overview ? (
            <button
              type="button"
              onClick={() => void loadPage(true)}
              disabled={refreshing}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-[#ccd8d2] bg-white px-4 text-sm font-extrabold text-[#315f4c] transition-colors hover:bg-[#f3f8f5] disabled:opacity-60"
            >
              {refreshing ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              Actualiser
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="mt-6">
            <Notice tone="error">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => void loadPage()}
                  className="font-extrabold underline underline-offset-2"
                >
                  Réessayer
                </button>
              </div>
            </Notice>
          </div>
        ) : null}

        {loading && !overview ? (
          <LoadingState label="Chargement des clients…" />
        ) : overview ? (
          <>
            <section
              className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              aria-label="Indicateurs clients et remboursements"
            >
              <MetricCard
                icon={Users}
                label="Clients inscrits"
                value={formatNumber(overview.stats.registeredClients)}
                detail={`${formatNumber(overview.stats.verifiedClients)} vérifiés · ${formatNumber(pendingVerification)} en attente`}
              />
              <MetricCard
                icon={Activity}
                label="Actifs maintenant"
                value={formatNumber(overview.stats.onlineClients)}
                detail={`Activité authentifiée il y a moins de ${overview.onlineWindowMinutes} min`}
                accent
              />
              <MetricCard
                icon={Files}
                label="Dossiers créés"
                value={formatNumber(overview.stats.totalCases)}
                detail={`${formatNumber(overview.stats.activeCases)} en cours · historique`}
              />
              <MetricCard
                icon={BadgeEuro}
                label="Potentiel total estimé"
                value={formatCents(overview.stats.estimatedRecoverableCents)}
                detail="Hors dossiers refusés ou annulés · historique"
              />
              <MetricCard
                icon={CheckCircle2}
                label="Déclarés remboursés"
                value={formatCents(overview.stats.estimatedRefundedCents)}
                detail={`${formatNumber(overview.stats.refundedCases)} dossier${overview.stats.refundedCases > 1 ? "s" : ""} · montant estimé`}
                accent
              />
              <MetricCard
                icon={UserCheck}
                label="Estimation moyenne"
                value={formatOptionalCents(
                  overview.stats.averageEstimatedRefundedCents,
                )}
                detail="Par dossier déclaré remboursé"
              />
            </section>

            <div className="mt-5 rounded-md border border-[#c9ddd3] bg-[#f3f8f5] px-4 py-3 text-xs leading-5 text-[#426353]">
              Les remboursements sont confirmés par les clients. Les montants
              affichés correspondent au montant récupérable estimé dans chaque
              dossier, pas au montant bancaire réellement reçu.
            </div>

            <section className="surface mt-6 overflow-hidden">
              <div className="border-b border-[#dce5e0] px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <h2 className="text-lg font-extrabold text-[#17211d]">
                      Clients inscrits
                    </h2>
                    <p className="mt-1 text-sm text-[#66736d]">
                      Informations de compte et synthèse de leurs dossiers SMS+.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <form
                      onSubmit={submitSearch}
                      className="flex min-w-0 gap-2 sm:min-w-[360px]"
                    >
                      <label className="relative min-w-0 flex-1">
                        <span className="sr-only">Rechercher un client</span>
                        <Search
                          aria-hidden="true"
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7b8781]"
                          size={16}
                        />
                        <input
                          type="search"
                          value={searchInput}
                          onChange={(event) =>
                            setSearchInput(event.target.value)
                          }
                          placeholder="Nom ou adresse e-mail"
                          maxLength={254}
                          className="field min-h-10 w-full pl-9"
                        />
                      </label>
                      <button
                        type="submit"
                        className="primary-button min-h-10 px-4 text-sm"
                      >
                        Rechercher
                      </button>
                    </form>

                    <label>
                      <span className="sr-only">Filtrer les clients</span>
                      <select
                        value={filter}
                        onChange={(event) => {
                          setFilter(event.target.value as ClientFilter);
                          setPage(1);
                        }}
                        className="field min-h-10 min-w-[190px] bg-white"
                      >
                        <option value="all">Tous les clients</option>
                        <option value="online">Actifs récemment</option>
                        <option value="offline">Hors ligne</option>
                        <option value="unverified">E-mail non vérifié</option>
                        <option value="with_cases">Avec un dossier</option>
                        <option value="refunded">Déclarés remboursés</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#7b8781]">
                  <span className="font-bold">
                    {formatNumber(overview.pagination.total)} résultat
                    {overview.pagination.total > 1 ? "s" : ""}
                  </span>
                  <span>
                    Données actualisées le{" "}
                    {formatDateTime(overview.generatedAt)}
                  </span>
                </div>
              </div>

              {overview.clients.length === 0 ? (
                <EmptyClients
                  filtered={Boolean(search) || filter !== "all"}
                  onClear={() => {
                    setSearchInput("");
                    setSearch("");
                    setFilter("all");
                    setPage(1);
                  }}
                />
              ) : (
                <>
                  <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full min-w-[1050px] border-collapse text-left">
                      <thead>
                        <tr className="bg-[#f8faf9] text-[11px] font-extrabold uppercase text-[#7b8781]">
                          <th className="px-6 py-3">Client</th>
                          <th className="px-4 py-3">Inscription</th>
                          <th className="px-4 py-3">Activité</th>
                          <th className="px-4 py-3">Dossiers</th>
                          <th className="px-4 py-3 text-right">
                            Potentiel estimé
                          </th>
                          <th className="px-6 py-3 text-right">
                            Déclaré remboursé
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e6ebe8]">
                        {overview.clients.map((client) => (
                          <ClientRow
                            key={client.id}
                            client={client}
                            onlineWindowMinutes={overview.onlineWindowMinutes}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="divide-y divide-[#e6ebe8] lg:hidden">
                    {overview.clients.map((client) => (
                      <ClientCard
                        key={client.id}
                        client={client}
                        onlineWindowMinutes={overview.onlineWindowMinutes}
                      />
                    ))}
                  </div>
                </>
              )}

              {overview.pagination.totalPages > 1 ? (
                <Pagination
                  page={overview.pagination.page}
                  totalPages={overview.pagination.totalPages}
                  disabled={loading || refreshing}
                  onPageChange={setPage}
                />
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className="surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[#7b8781]">
            {label}
          </p>
          <p className="mt-3 truncate text-3xl font-extrabold text-[#17211d]">
            {value}
          </p>
        </div>
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${
            accent ? "bg-[#087a55] text-white" : "bg-[#e9f5ef] text-[#087a55]"
          }`}
        >
          <Icon size={19} />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#66736d]">{detail}</p>
    </article>
  );
}

function ClientRow({
  client,
  onlineWindowMinutes,
}: {
  client: AdminClient;
  onlineWindowMinutes: number;
}) {
  return (
    <tr className="text-sm transition-colors hover:bg-[#fbfcfb]">
      <td className="px-6 py-4">
        <ClientIdentity client={client} />
      </td>
      <td className="px-4 py-4 text-[#59665f]">
        <p className="font-semibold">{formatDate(client.createdAt)}</p>
        <VerificationBadge verified={Boolean(client.emailVerifiedAt)} />
      </td>
      <td className="px-4 py-4">
        <ActivityStatus
          client={client}
          onlineWindowMinutes={onlineWindowMinutes}
        />
      </td>
      <td className="px-4 py-4 text-[#59665f]">
        <p className="font-extrabold text-[#24332c]">
          {formatNumber(client.caseCount)} dossier
          {client.caseCount > 1 ? "s" : ""}
        </p>
        <p className="mt-1 text-xs">
          {formatNumber(client.activeCaseCount)} en cours ·{" "}
          {formatNumber(client.refundedCaseCount)} remboursé
          {client.refundedCaseCount > 1 ? "s" : ""}
        </p>
      </td>
      <td className="px-4 py-4 text-right font-extrabold text-[#24332c]">
        {formatCents(client.estimatedRecoverableCents)}
      </td>
      <td className="px-6 py-4 text-right">
        <p className="font-extrabold text-[#087a55]">
          {formatCents(client.estimatedRefundedCents)}
        </p>
        <p className="mt-1 text-xs text-[#7b8781]">
          Moy. {formatOptionalCents(client.averageEstimatedRefundedCents)}
        </p>
      </td>
    </tr>
  );
}

function ClientCard({
  client,
  onlineWindowMinutes,
}: {
  client: AdminClient;
  onlineWindowMinutes: number;
}) {
  return (
    <article className="px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ClientIdentity client={client} />
        <VerificationBadge verified={Boolean(client.emailVerifiedAt)} />
      </div>
      <div className="mt-4">
        <ActivityStatus
          client={client}
          onlineWindowMinutes={onlineWindowMinutes}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#e6ebe8] pt-4 text-sm">
        <div>
          <dt className="text-xs font-bold text-[#7b8781]">Inscription</dt>
          <dd className="mt-1 font-semibold text-[#3d4c45]">
            {formatDate(client.createdAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-[#7b8781]">Dossiers</dt>
          <dd className="mt-1 font-semibold text-[#3d4c45]">
            {formatNumber(client.caseCount)} ·{" "}
            {formatNumber(client.refundedCaseCount)} remboursé
            {client.refundedCaseCount > 1 ? "s" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-[#7b8781]">Potentiel estimé</dt>
          <dd className="mt-1 font-extrabold text-[#24332c]">
            {formatCents(client.estimatedRecoverableCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-[#7b8781]">
            Déclaré remboursé
          </dt>
          <dd className="mt-1 font-extrabold text-[#087a55]">
            {formatCents(client.estimatedRefundedCents)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function ClientIdentity({ client }: { client: AdminClient }) {
  const name = [client.firstName, client.lastName].filter(Boolean).join(" ");
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#e9f5ef] text-xs font-extrabold text-[#087a55]">
        {clientInitials(client)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-extrabold text-[#24332c]">
          {name || "Nom non renseigné"}
        </p>
        <a
          href={`mailto:${client.email}`}
          className="mt-0.5 block max-w-[280px] truncate text-xs font-semibold text-[#087a55] hover:underline"
        >
          {client.email}
        </a>
      </div>
    </div>
  );
}

function ActivityStatus({
  client,
  onlineWindowMinutes,
}: {
  client: AdminClient;
  onlineWindowMinutes: number;
}) {
  return (
    <div>
      <span
        className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-extrabold ${
          client.isOnline
            ? "bg-[#e8f6ef] text-[#087a55]"
            : "bg-[#eef2f0] text-[#66736d]"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            client.isOnline ? "bg-[#0aa56f]" : "bg-[#98a39e]"
          }`}
        />
        {client.isOnline
          ? `Actif il y a moins de ${onlineWindowMinutes} min`
          : "Hors ligne"}
      </span>
      <p className="mt-1.5 max-w-[230px] text-xs leading-5 text-[#7b8781]">
        {client.lastActivityAt
          ? `Dernière activité de session connue : ${formatDateTime(client.lastActivityAt)}`
          : "Aucune activité de session connue"}
      </p>
    </div>
  );
}

function VerificationBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={`mt-1 inline-flex rounded-md px-2 py-1 text-[11px] font-bold ${
        verified ? "bg-[#e8f6ef] text-[#087a55]" : "bg-[#fff3df] text-[#946200]"
      }`}
    >
      {verified ? "E-mail vérifié" : "Vérification en attente"}
    </span>
  );
}

function EmptyClients({
  filtered,
  onClear,
}: {
  filtered: boolean;
  onClear: () => void;
}) {
  return (
    <div className="px-5 py-14 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-[#edf2ef] text-[#66736d]">
        <Users size={23} />
      </span>
      <p className="mt-4 text-sm font-extrabold text-[#526058]">
        {filtered
          ? "Aucun client ne correspond à ces critères"
          : "Aucun client inscrit pour le moment"}
      </p>
      {filtered ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 text-sm font-extrabold text-[#087a55] hover:underline"
        >
          Afficher tous les clients
        </button>
      ) : null}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  disabled,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  disabled: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[#dce5e0] px-5 py-4 sm:px-6">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 1}
        className="min-h-9 rounded-md border border-[#ccd8d2] bg-white px-3 text-xs font-extrabold text-[#315f4c] hover:bg-[#f3f8f5] disabled:cursor-not-allowed disabled:opacity-45"
      >
        Précédent
      </button>
      <span className="text-xs font-bold text-[#66736d]">
        Page {formatNumber(page)} sur {formatNumber(totalPages)}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || page >= totalPages}
        className="min-h-9 rounded-md border border-[#ccd8d2] bg-white px-3 text-xs font-extrabold text-[#315f4c] hover:bg-[#f3f8f5] disabled:cursor-not-allowed disabled:opacity-45"
      >
        Suivant
      </button>
    </div>
  );
}

function readOverview(value: unknown): AdminClientsOverview | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const stats = readStats(root.stats);
  const pagination = readPagination(root.pagination);
  if (
    typeof root.generatedAt !== "string" ||
    typeof root.onlineWindowMinutes !== "number" ||
    !stats ||
    !pagination ||
    !Array.isArray(root.clients)
  ) {
    return null;
  }

  const clients = root.clients.map(readClient);
  if (clients.some((client) => client === null)) return null;
  return {
    generatedAt: root.generatedAt,
    onlineWindowMinutes: root.onlineWindowMinutes,
    stats,
    clients: clients as AdminClient[],
    pagination,
  };
}

function readStats(value: unknown): AdminClientsOverview["stats"] | null {
  if (!value || typeof value !== "object") return null;
  const stats = value as Record<string, unknown>;
  const keys = [
    "registeredClients",
    "verifiedClients",
    "onlineClients",
    "totalCases",
    "activeCases",
    "refundedCases",
    "estimatedRecoverableCents",
    "estimatedRefundedCents",
  ] as const;
  if (keys.some((key) => typeof stats[key] !== "number")) return null;
  if (
    stats.averageEstimatedRefundedCents !== null &&
    typeof stats.averageEstimatedRefundedCents !== "number"
  ) {
    return null;
  }
  return stats as AdminClientsOverview["stats"];
}

function readPagination(
  value: unknown,
): AdminClientsOverview["pagination"] | null {
  if (!value || typeof value !== "object") return null;
  const pagination = value as Record<string, unknown>;
  if (
    typeof pagination.page !== "number" ||
    typeof pagination.limit !== "number" ||
    typeof pagination.total !== "number" ||
    typeof pagination.totalPages !== "number"
  ) {
    return null;
  }
  return pagination as AdminClientsOverview["pagination"];
}

function readClient(value: unknown): AdminClient | null {
  if (!value || typeof value !== "object") return null;
  const client = value as Record<string, unknown>;
  const numericKeys = [
    "activeSessionCount",
    "caseCount",
    "activeCaseCount",
    "refundedCaseCount",
    "estimatedRecoverableCents",
    "estimatedRefundedCents",
  ] as const;
  if (
    typeof client.id !== "string" ||
    typeof client.email !== "string" ||
    typeof client.createdAt !== "string" ||
    typeof client.isOnline !== "boolean" ||
    numericKeys.some((key) => typeof client[key] !== "number") ||
    !nullableString(client.firstName) ||
    !nullableString(client.lastName) ||
    !nullableString(client.emailVerifiedAt) ||
    !nullableString(client.lastActivityAt) ||
    (client.averageEstimatedRefundedCents !== null &&
      typeof client.averageEstimatedRefundedCents !== "number")
  ) {
    return null;
  }
  return client as AdminClient;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function clientInitials(client: AdminClient): string {
  const first = client.firstName?.trim().charAt(0) ?? "";
  const last = client.lastName?.trim().charAt(0) ?? "";
  if (first || last) return `${first}${last}`.toUpperCase();
  return (client.email.slice(0, 2) || "CL").toUpperCase();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatOptionalCents(value: number | null): string {
  return value === null ? "—" : formatCents(value);
}
