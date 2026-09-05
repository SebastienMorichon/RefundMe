"use client";

import { Eye, FileText, LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { apiFetch as fetch } from "../../../lib/api-client";

type SessionUser = { id: string; email: string; role: string };
type ClientInvoice = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  uploadedAt: string;
  analyzedAt: string | null;
  customerEmail: string;
  cases: Array<{ id: string; status: string }>;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function AdminInvoicesPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [invoices, setInvoices] = useState<ClientInvoice[]>([]);
  const [message, setMessage] = useState("Verification de votre acces administrateur...");
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    void loadPage();
  }, []);

  async function loadPage() {
    try {
      const sessionResponse = await fetch(`${apiUrl}/auth/me`, { credentials: "include" });
      const sessionPayload = await readJson(sessionResponse);
      const sessionUser = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !sessionUser) {
        setMessage("Connectez-vous avec un compte administrateur.");
        return;
      }
      setUser(sessionUser);
      if (sessionUser.role !== "ADMIN") {
        setMessage("Ce compte n'a pas les droits administrateur.");
        return;
      }

      const response = await fetch(`${apiUrl}/admin/invoices`, { credentials: "include" });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Impossible de charger les factures."));
      }
      const parsedInvoices = Array.isArray(payload.invoices)
        ? payload.invoices.flatMap((invoice) => {
            const parsed = readInvoice(invoice);
            return parsed ? [parsed] : [];
          })
        : [];
      setInvoices(parsedInvoices);
      setMessage(`${parsedInvoices.length} facture${parsedInvoices.length > 1 ? "s" : ""} client${parsedInvoices.length > 1 ? "s" : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "L'API Lydoc est indisponible.");
    }
  }

  async function viewInvoice(invoice: ClientInvoice) {
    setOpeningId(invoice.id);
    setMessage(`Ouverture securisee de ${invoice.originalName}...`);
    try {
      const response = await fetch(`${apiUrl}/admin/invoices/${invoice.id}/file`, { credentials: "include" });
      if (!response.ok) {
        const payload = await readJson(response);
        throw new Error(errorMessage(payload, "Impossible d'ouvrir cette facture."));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("Facture ouverte. Cette consultation a ete enregistree dans le journal d'audit.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible d'ouvrir cette facture.");
    } finally {
      setOpeningId(null);
    }
  }

  const canViewInvoices = user?.role === "ADMIN";

  return (
    <AppShell active="admin-invoices" email={user?.email} isAdmin>
      <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <p className="text-xs font-extrabold uppercase text-[#7b8781]">Administration</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">Factures clients</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736d]">
          Consultez les factures operateur deposees par les clients et leur etat d'analyse.
        </p>
        <div className="mt-5 border-l-4 border-[#087a55] bg-[#e9f5ef] p-4 text-sm text-[#2f6b53]">{message}</div>

        {canViewInvoices ? (
          <section className="surface mt-6 overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-[#dce5e0] px-5 py-5 sm:px-6">
              <div>
                <h2 className="text-lg font-extrabold text-[#17211d]">Documents recus</h2>
                <p className="mt-1 text-sm text-[#66736d]">Seules les factures clients sont affichees ici.</p>
              </div>
              <span className="text-xs font-bold text-[#7b8781]">{invoices.length} document{invoices.length > 1 ? "s" : ""}</span>
            </div>

            {invoices.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-[#edf2f8] text-[#66736d]"><FileText size={23} /></span>
                <p className="mt-4 text-sm font-extrabold text-[#526058]">Aucune facture client</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] border-collapse text-left">
                  <thead>
                    <tr className="bg-[#f8fafc] text-[11px] font-extrabold uppercase text-[#7b8781]">
                      <th className="px-6 py-3">Facture</th>
                      <th className="px-4 py-3">Client</th>
                      <th className="px-4 py-3">Depot</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3">Dossier</th>
                      <th className="px-6 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6ebf1]">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="text-sm hover:bg-[#fbfcfe]">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#e9f5ef] text-[#087a55]"><FileText size={17} /></span>
                            <div className="min-w-0">
                              <p className="max-w-[260px] truncate font-extrabold text-[#24332c]">{invoice.originalName}</p>
                              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#7b8781]"><LockKeyhole size={11} /> {formatBytes(invoice.sizeBytes)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 font-semibold text-[#59665f]">{invoice.customerEmail}</td>
                        <td className="px-4 py-4 text-[#66736d]">{formatDate(invoice.uploadedAt)}</td>
                        <td className="px-4 py-4"><StatusBadge status={invoice.status} /></td>
                        <td className="px-4 py-4 text-[#66736d]">{invoice.cases.length ? `${invoice.cases.length} dossier${invoice.cases.length > 1 ? "s" : ""}` : "Aucun"}</td>
                        <td className="px-6 py-4 text-right">
                          <button type="button" onClick={() => void viewInvoice(invoice)} disabled={openingId !== null} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#cfd8e6] bg-white px-3 text-xs font-extrabold text-[#087a55] hover:bg-[#e9f5ef] disabled:opacity-50">
                            {openingId === invoice.id ? <LoaderCircle className="animate-spin" size={15} /> : <Eye size={15} />} Consulter
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const analyzed = status === "ANALYZED";
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-bold ${analyzed ? "bg-[#e6f7ef] text-[#087f3f]" : "bg-[#fff3df] text-[#9b6500]"}`}>{analyzed ? "Analysee" : statusLabel(status)}</span>;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    UPLOADED: "Deposee",
    OCR_PENDING: "OCR en attente",
    OCR_DONE: "OCR termine",
    ANALYSIS_PENDING: "Analyse en cours",
    FAILED: "Echec",
  };
  return labels[status] ?? status;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.message === "string" ? payload.message : fallback;
}

function readUser(value: unknown): SessionUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string" && typeof user.email === "string" && typeof user.role === "string"
    ? { id: user.id, email: user.email, role: user.role }
    : null;
}

function readInvoice(value: unknown): ClientInvoice | null {
  if (!value || typeof value !== "object") return null;
  const invoice = value as Record<string, unknown>;
  if (
    typeof invoice.id !== "string" ||
    typeof invoice.originalName !== "string" ||
    typeof invoice.mimeType !== "string" ||
    typeof invoice.sizeBytes !== "number" ||
    typeof invoice.status !== "string" ||
    typeof invoice.uploadedAt !== "string" ||
    typeof invoice.customerEmail !== "string" ||
    !Array.isArray(invoice.cases)
  ) return null;

  return {
    id: invoice.id,
    originalName: invoice.originalName,
    mimeType: invoice.mimeType,
    sizeBytes: invoice.sizeBytes,
    status: invoice.status,
    uploadedAt: invoice.uploadedAt,
    analyzedAt: typeof invoice.analyzedAt === "string" ? invoice.analyzedAt : null,
    customerEmail: invoice.customerEmail,
    cases: invoice.cases.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      return typeof item.id === "string" && typeof item.status === "string" ? [{ id: item.id, status: item.status }] : [];
    }),
  };
}
