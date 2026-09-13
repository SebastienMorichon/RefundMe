"use client";

import {
  ArrowDown,
  ChartNoAxesCombined,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { apiFetch as fetch } from "../../../lib/api-client";
import { apiUrl, readJson, readUser } from "../../../lib/client-data";

type FunnelWindow = {
  days: number | null;
  label: string;
  registered: number;
  verified: number;
  invoiceUploaded: number;
  caseCreated: number;
  packetDownloaded: number;
  refunded: number;
};

type FunnelOverview = {
  generatedAt: string;
  definition: string;
  windows: FunnelWindow[];
};

const steps: Array<{ key: keyof FunnelWindow; label: string }> = [
  { key: "registered", label: "Comptes commencés" },
  { key: "verified", label: "E-mails vérifiés" },
  { key: "invoiceUploaded", label: "Factures déposées" },
  { key: "caseCreated", label: "Dossiers créés" },
  { key: "packetDownloaded", label: "PDF téléchargés" },
  { key: "refunded", label: "Remboursements déclarés" },
];

export default function AdminMarketingPage() {
  const [overview, setOverview] = useState<FunnelOverview | null>(null);
  const [email, setEmail] = useState<string>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sessionResponse, response] = await Promise.all([
        fetch(`${apiUrl}/auth/me`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`${apiUrl}/admin/marketing/funnel`, {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const sessionPayload = await readJson(sessionResponse);
      const user = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !user) {
        window.location.href = "/connexion";
        return;
      }
      if (user.role !== "ADMIN") {
        window.location.href = "/dashboard";
        return;
      }
      setEmail(user.email);
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isOverview(payload)) {
        throw new Error("Les indicateurs ne sont pas disponibles.");
      }
      setOverview(payload);
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Chargement impossible.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell active="admin-marketing" email={email} isAdmin>
      <div className="page-container py-8 sm:py-10">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Pilotage du lancement</p>
            <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">
              Acquisition et activation
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66736d]">
              Le parcours produit est calculé à partir des données métier déjà
              présentes. Aucun identifiant ni document client n’est affiché.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="secondary-button inline-flex items-center justify-center gap-2"
          >
            {loading ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Actualiser
          </button>
        </div>

        {error ? (
          <div className="mt-8 border-l-4 border-[#e9654b] bg-[#fff0ec] p-5 text-sm text-[#8e3d2c]">
            {error}
          </div>
        ) : null}

        {overview ? (
          <div className="mt-8 grid gap-6">
            {overview.windows.map((window) => (
              <section
                key={window.label}
                className="rounded-[20px] border border-[#dce5e0] bg-white p-5 shadow-[0_12px_30px_rgba(23,33,29,0.05)] sm:p-7"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-[#e8f7f0] text-[#087a55]">
                    <ChartNoAxesCombined size={20} />
                  </span>
                  <div>
                    <h2 className="font-extrabold text-[#17211d]">
                      {window.label}
                    </h2>
                    <p className="text-xs text-[#7b8781]">
                      Cohorte selon la date de création du compte
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  {steps.map((step, index) => {
                    const value = window[step.key] as number;
                    const previous =
                      index === 0
                        ? null
                        : (window[steps[index - 1]!.key] as number);
                    return (
                      <div
                        key={step.key}
                        className="relative rounded-md bg-[#f3f6fa] p-4"
                      >
                        <p className="text-2xl font-extrabold text-[#17211d]">
                          {formatNumber(value)}
                        </p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-[#66736d]">
                          {step.label}
                        </p>
                        {previous !== null ? (
                          <p className="mt-3 inline-flex items-center gap-1 text-xs font-extrabold text-[#087a55]">
                            <ArrowDown size={13} />{" "}
                            {formatRate(value, previous)}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            <p className="text-xs leading-5 text-[#7b8781]">
              Généré le {formatDate(overview.generatedAt)}. Les visites et leur
              provenance seront ajoutées séparément après configuration d’une
              mesure d’audience conforme aux choix de confidentialité.
            </p>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function isOverview(value: unknown): value is FunnelOverview {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.generatedAt === "string" &&
    typeof input.definition === "string" &&
    Array.isArray(input.windows) &&
    input.windows.every(isWindow)
  );
}

function isWindow(value: unknown): value is FunnelWindow {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.label === "string" &&
    steps.every((step) => typeof input[step.key] === "number")
  );
}

function formatRate(value: number, previous: number): string {
  if (previous === 0) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / previous);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
