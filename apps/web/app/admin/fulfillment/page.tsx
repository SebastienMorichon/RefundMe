"use client";

import {
  CheckCircle2,
  Download,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Send,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { apiFetch as fetch } from "../../../lib/api-client";

type SessionUser = { id: string; email: string; role: string };
type FulfillmentCase = {
  id: string;
  status: string;
  createdAt: string;
  customer: { email: string; name: string | null };
  payment: { amountCents: number; paidAt: string | null } | null;
  shipment: { product: string; status: string; postageCents: number } | null;
  packetReady: boolean;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function AdminFulfillmentPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [cases, setCases] = useState<FulfillmentCase[]>([]);
  const [isBusy, setIsBusy] = useState(true);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [message, setMessage] = useState("Chargement des envois payés...");
  const [error, setError] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setIsBusy(true);
    try {
      const [sessionResponse, listResponse] = await Promise.all([
        fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
        fetch(`${apiUrl}/admin/fulfillment`, { credentials: "include" }),
      ]);
      const [sessionPayload, listPayload] = await Promise.all([
        readJson(sessionResponse),
        readJson(listResponse),
      ]);
      const sessionUser = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !sessionUser || sessionUser.role !== "ADMIN") {
        throw new Error("Accès administrateur requis.");
      }
      if (!listResponse.ok) throw new Error(readError(listPayload, "Chargement impossible."));
      const loaded = readCases(listPayload.cases);
      setUser(sessionUser);
      setCases(loaded);
      setMessage(loaded.length ? `${loaded.length} envoi${loaded.length > 1 ? "s" : ""} à traiter.` : "Aucun envoi en attente.");
      setError(false);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Chargement impossible.");
      setError(true);
    } finally { setIsBusy(false); }
  }

  async function markSent(item: FulfillmentCase) {
    if (
      !window.confirm(
        "Confirmez uniquement après avoir réellement remis ce courrier à La Poste. Le client sera informé.",
      )
    ) return;
    setActiveCaseId(item.id);
    setMessage("Enregistrement de la remise à La Poste...");
    setError(false);
    try {
      const response = await fetch(`${apiUrl}/admin/fulfillment/${item.id}/sent`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(readError(payload, "Mise à jour impossible."));
      setCases((current) => current.filter((candidate) => candidate.id !== item.id));
      setMessage(`Le dossier ${shortId(item.id)} est marqué comme envoyé.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Mise à jour impossible.");
      setError(true);
    } finally { setActiveCaseId(null); }
  }

  return (
    <AppShell active="admin-fulfillment" email={user?.email} isAdmin>
      <div className="mx-auto max-w-[1100px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase text-[#7b8781]">Administration</p>
            <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">Envois à traiter</h1>
            <p className="mt-2 text-sm leading-6 text-[#66736d]">Téléchargez le dossier payé, effectuez l’e‑Lettre rouge, puis confirmez sa remise.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={isBusy} className="secondary-button">
            <RefreshCw size={16} className={isBusy ? "animate-spin" : ""} /> Actualiser
          </button>
        </div>
        <div className={`mt-5 border-l-4 p-4 text-sm ${error ? "border-[#d9482f] bg-[#fff0ec] text-[#8e3d2c]" : "border-[#087a55] bg-[#eaf7f1] text-[#315f4c]"}`}>{message}</div>

        <section className="surface mt-6 overflow-hidden">
          {isBusy && !cases.length ? (
            <div className="grid place-items-center gap-3 px-6 py-16 text-sm text-[#66736d]"><LoaderCircle className="animate-spin text-[#087a55]" /> Chargement...</div>
          ) : cases.length ? (
            <div className="divide-y divide-[#e3e9e6]">
              {cases.map((item) => (
                <article key={item.id} className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid h-9 w-9 place-items-center rounded-md bg-[#e9f5ef] text-[#087a55]"><PackageCheck size={18} /></span>
                      <div>
                        <h2 className="font-extrabold text-[#24332c]">{item.customer.name || "Client Lydoc"}</h2>
                        <p className="text-xs text-[#66736d]">{item.customer.email} · dossier {shortId(item.id)}</p>
                      </div>
                    </div>
                    <dl className="mt-4 flex flex-wrap gap-x-7 gap-y-2 text-xs text-[#66736d]">
                      <span><dt className="inline font-bold">Payé : </dt><dd className="inline">{item.payment?.paidAt ? formatDate(item.payment.paidAt) : "confirmé"}</dd></span>
                      <span><dt className="inline font-bold">Montant : </dt><dd className="inline">{formatCents(item.payment?.amountCents ?? 0)}</dd></span>
                      <span><dt className="inline font-bold">Envoi : </dt><dd className="inline">{item.shipment?.product === "vertesuivi" ? "suivi" : "e‑Lettre rouge"}</dd></span>
                    </dl>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={`${apiUrl}/admin/fulfillment/${item.id}/dossier.pdf`} className={`secondary-button ${item.packetReady ? "" : "pointer-events-none opacity-50"}`}>
                      <Download size={16} /> Télécharger le PDF
                    </a>
                    <button type="button" onClick={() => void markSent(item)} disabled={activeCaseId === item.id || !item.packetReady} className="primary-button">
                      {activeCaseId === item.id ? <LoaderCircle className="animate-spin" size={16} /> : <Send size={16} />} Marquer envoyé
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="px-6 py-16 text-center"><CheckCircle2 className="mx-auto text-[#087a55]" size={28} /><p className="mt-4 text-sm font-extrabold text-[#526058]">Tout est à jour.</p></div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function readCases(value: unknown): FulfillmentCase[] { return Array.isArray(value) ? value.flatMap((item) => { const parsed = readCase(item); return parsed ? [parsed] : []; }) : []; }
function readCase(value: unknown): FulfillmentCase | null { if (!value || typeof value !== "object") return null; const item = value as Record<string, unknown>; const customer = item.customer as Record<string, unknown> | undefined; if (typeof item.id !== "string" || typeof item.status !== "string" || typeof item.createdAt !== "string" || typeof item.packetReady !== "boolean" || !customer || typeof customer.email !== "string") return null; return item as FulfillmentCase; }
function readUser(value: unknown): SessionUser | null { return value && typeof value === "object" && typeof (value as SessionUser).id === "string" && typeof (value as SessionUser).email === "string" && typeof (value as SessionUser).role === "string" ? value as SessionUser : null; }
async function readJson(response: Response): Promise<Record<string, unknown>> { try { const value: unknown = await response.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return {}; } }
function readError(payload: Record<string, unknown>, fallback: string) { return typeof payload.message === "string" ? payload.message : fallback; }
function shortId(value: string) { return value.slice(-8).toUpperCase(); }
function formatCents(cents: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100); }
function formatDate(value: string) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
