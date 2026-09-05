"use client";

import {
  BadgeEuro,
  CheckCircle2,
  LoaderCircle,
  Printer,
  ReceiptText,
  Save,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { apiFetch as fetch } from "../../../lib/api-client";

type SessionUser = { id: string; email: string; role: string };
type PostalProduct = "verte" | "vertesuivi";
type Pricing = {
  serviceFeeCents: number;
  printingBaseCents: number;
  printingPerAdditionalPageCents: number;
  greenLetterCents: number;
  trackedGreenLetterCents: number;
  defaultPostalProduct: PostalProduct;
  updatedAt: string;
};

type PricingForm = {
  serviceFeeEuros: string;
  printingBaseEuros: string;
  printingPerAdditionalPageEuros: string;
  greenLetterEuros: string;
  trackedGreenLetterEuros: string;
  defaultPostalProduct: PostalProduct;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const samplePageCount = 7;

export default function AdminPricingPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [form, setForm] = useState<PricingForm>(emptyForm());
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("Vérification de votre accès administrateur...");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void loadPage();
  }, []);

  const preview = useMemo(() => calculatePreview(form), [form]);

  async function loadPage() {
    try {
      const sessionResponse = await fetch(`${apiUrl}/auth/me`, { credentials: "include" });
      const sessionPayload = await readJson(sessionResponse);
      const sessionUser = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !sessionUser) {
        setMessage("Connectez-vous avec un compte administrateur.");
        setMessageTone("error");
        return;
      }
      setUser(sessionUser);
      if (sessionUser.role !== "ADMIN") {
        setMessage("Ce compte n'a pas les droits administrateur.");
        setMessageTone("error");
        return;
      }

      const response = await fetch(`${apiUrl}/admin/pricing`, { credentials: "include" });
      const payload = await readJson(response);
      const pricing = readPricing(payload.pricing);
      if (!response.ok || !pricing) {
        throw new Error(errorMessage(payload, "Impossible de charger les tarifs."));
      }
      hydrate(pricing);
      setMessage("Tarifs client chargés.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "L'API Lydoc est indisponible.");
      setMessageTone("error");
    }
  }

  async function savePricing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = formToPayload(form);
    if (!body) {
      setMessage("Tous les montants doivent être positifs ou nuls, avec deux décimales maximum.");
      setMessageTone("error");
      return;
    }

    setIsBusy(true);
    setMessage("Enregistrement des tarifs...");
    setMessageTone("info");
    try {
      const response = await fetch(`${apiUrl}/admin/pricing`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      const pricing = readPricing(payload.pricing);
      if (!response.ok || !pricing) {
        throw new Error(errorMessage(payload, "Impossible d'enregistrer les tarifs."));
      }
      hydrate(pricing);
      setMessage("Tarifs enregistrés. Ils seront appliqués aux prochains devis.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impossible d'enregistrer les tarifs.");
      setMessageTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  function hydrate(pricing: Pricing) {
    setForm({
      serviceFeeEuros: centsToInput(pricing.serviceFeeCents),
      printingBaseEuros: centsToInput(pricing.printingBaseCents),
      printingPerAdditionalPageEuros: centsToInput(pricing.printingPerAdditionalPageCents),
      greenLetterEuros: centsToInput(pricing.greenLetterCents),
      trackedGreenLetterEuros: centsToInput(pricing.trackedGreenLetterCents),
      defaultPostalProduct: pricing.defaultPostalProduct,
    });
    setUpdatedAt(pricing.updatedAt);
  }

  const canManagePricing = user?.role === "ADMIN";

  return (
    <AppShell active="admin-pricing" email={user?.email} isAdmin>
      <div className="mx-auto max-w-[1180px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <p className="text-xs font-extrabold uppercase text-[#7b8781]">Administration</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">Tarification</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736d]">
          Tarifs TTC facturés pour la prise en charge, l’impression et l’envoi postal.
        </p>
        <div className={`mt-5 border-l-4 p-4 text-sm ${noticeClass(messageTone)}`}>
          {message}
        </div>

        {canManagePricing ? (
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <form onSubmit={savePricing} className="surface overflow-hidden">
              <PricingSection
                icon={<BadgeEuro size={20} />}
                title="Service Lydoc"
                description="Vérification finale et préparation du dossier."
              >
                <MoneyField
                  label="Frais de service"
                  value={form.serviceFeeEuros}
                  onChange={(value) => setForm((current) => ({ ...current, serviceFeeEuros: value }))}
                />
              </PricingSection>

              <PricingSection
                icon={<Printer size={20} />}
                title="Impression"
                description="Le forfait inclut la première page du dossier."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField
                    label="Forfait d’impression"
                    value={form.printingBaseEuros}
                    onChange={(value) => setForm((current) => ({ ...current, printingBaseEuros: value }))}
                  />
                  <MoneyField
                    label="Page supplémentaire"
                    value={form.printingPerAdditionalPageEuros}
                    onChange={(value) => setForm((current) => ({ ...current, printingPerAdditionalPageEuros: value }))}
                  />
                </div>
              </PricingSection>

              <PricingSection
                icon={<Send size={20} />}
                title="Affranchissement"
                description="Montants facturés au client selon le mode postal."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyField
                    label="Lettre verte"
                    value={form.greenLetterEuros}
                    onChange={(value) => setForm((current) => ({ ...current, greenLetterEuros: value }))}
                  />
                  <MoneyField
                    label="Lettre verte suivie"
                    value={form.trackedGreenLetterEuros}
                    onChange={(value) => setForm((current) => ({ ...current, trackedGreenLetterEuros: value }))}
                  />
                </div>
                <fieldset className="mt-5">
                  <legend className="text-sm font-extrabold text-[#24332c]">Mode proposé par défaut</legend>
                  <div className="mt-2 grid grid-cols-2 rounded-md border border-[#cfd9d4] bg-[#f6f8f7] p-1">
                    <PostalModeButton
                      active={form.defaultPostalProduct === "verte"}
                      label="Lettre verte"
                      onClick={() => setForm((current) => ({ ...current, defaultPostalProduct: "verte" }))}
                    />
                    <PostalModeButton
                      active={form.defaultPostalProduct === "vertesuivi"}
                      label="Avec suivi"
                      onClick={() => setForm((current) => ({ ...current, defaultPostalProduct: "vertesuivi" }))}
                    />
                  </div>
                </fieldset>
              </PricingSection>

              <div className="flex flex-col gap-3 border-t border-[#e3e9e6] bg-[#fafcfb] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-xs text-[#66736d]">
                  {updatedAt ? `Dernière modification : ${formatDate(updatedAt)}` : "Configuration initiale"}
                </p>
                <button type="submit" disabled={isBusy} className="primary-button min-w-[190px]">
                  {isBusy ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}
                  Enregistrer
                </button>
              </div>
            </form>

            <aside className="surface overflow-hidden lg:sticky lg:top-24">
              <div className="border-b border-[#e3e9e6] px-5 py-5">
                <span className="grid h-10 w-10 place-items-center rounded-md bg-[#e9f5ef] text-[#087a55]">
                  <ReceiptText size={19} />
                </span>
                <p className="mt-4 text-xs font-extrabold uppercase text-[#7b8781]">Simulation</p>
                <h2 className="mt-1 text-lg font-extrabold text-[#17211d]">Dossier de {samplePageCount} pages</h2>
              </div>
              <dl className="divide-y divide-[#e3e9e6] px-5">
                <SummaryLine label="Service" cents={preview.serviceFeeCents} />
                <SummaryLine label="Impression" cents={preview.printingCents} />
                <SummaryLine label={preview.postageLabel} cents={preview.postageCents} />
                <SummaryLine label="Total client" cents={preview.totalCents} strong />
              </dl>
              <div className="flex items-start gap-3 border-t border-[#e3e9e6] bg-[#f2f8f5] px-5 py-4 text-xs leading-5 text-[#426452]">
                <CheckCircle2 className="mt-0.5 shrink-0 text-[#087a55]" size={16} />
                Le tarif est figé lors de la création du devis.
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function PricingSection({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-5 border-b border-[#e3e9e6] px-5 py-6 sm:grid-cols-[190px_1fr] sm:px-6">
      <div>
        <span className="grid h-10 w-10 place-items-center rounded-md bg-[#e9f5ef] text-[#087a55]">{icon}</span>
        <h2 className="mt-3 text-base font-extrabold text-[#17211d]">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[#66736d]">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2 text-sm font-extrabold text-[#24332c]">
      {label}
      <span className="relative block">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="field w-full pr-14 font-normal"
          aria-label={`${label} en euros`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-bold text-[#7b8781]">EUR</span>
      </span>
    </label>
  );
}

function PostalModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 rounded-md px-3 text-xs font-extrabold transition-colors ${active ? "bg-white text-[#087a55] shadow-sm" : "text-[#66736d] hover:text-[#17211d]"}`}
    >
      {label}
    </button>
  );
}

function SummaryLine({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <dt className={strong ? "font-extrabold text-[#17211d]" : "text-sm text-[#66736d]"}>{label}</dt>
      <dd className={strong ? "text-lg font-extrabold text-[#087a55]" : "text-sm font-extrabold text-[#24332c]"}>{formatCents(cents)}</dd>
    </div>
  );
}

function calculatePreview(form: PricingForm) {
  const serviceFeeCents = parseEuros(form.serviceFeeEuros) ?? 0;
  const printingBaseCents = parseEuros(form.printingBaseEuros) ?? 0;
  const perPageCents = parseEuros(form.printingPerAdditionalPageEuros) ?? 0;
  const printingCents = printingBaseCents + (samplePageCount - 1) * perPageCents;
  const postageCents = form.defaultPostalProduct === "verte"
    ? parseEuros(form.greenLetterEuros) ?? 0
    : parseEuros(form.trackedGreenLetterEuros) ?? 0;
  return {
    serviceFeeCents,
    printingCents,
    postageCents,
    totalCents: serviceFeeCents + printingCents + postageCents,
    postageLabel: form.defaultPostalProduct === "verte" ? "Lettre verte" : "Lettre verte suivie",
  };
}

function formToPayload(form: PricingForm): Record<string, number | PostalProduct> | null {
  const serviceFeeCents = parseEuros(form.serviceFeeEuros);
  const printingBaseCents = parseEuros(form.printingBaseEuros);
  const printingPerAdditionalPageCents = parseEuros(form.printingPerAdditionalPageEuros);
  const greenLetterCents = parseEuros(form.greenLetterEuros);
  const trackedGreenLetterCents = parseEuros(form.trackedGreenLetterEuros);
  if (
    serviceFeeCents === null || printingBaseCents === null ||
    printingPerAdditionalPageCents === null || greenLetterCents === null ||
    trackedGreenLetterCents === null
  ) return null;
  return {
    serviceFeeCents,
    printingBaseCents,
    printingPerAdditionalPageCents,
    greenLetterCents,
    trackedGreenLetterCents,
    defaultPostalProduct: form.defaultPostalProduct,
  };
}

function parseEuros(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000) return null;
  return Math.round(amount * 100);
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function emptyForm(): PricingForm {
  return {
    serviceFeeEuros: "0,00",
    printingBaseEuros: "0,00",
    printingPerAdditionalPageEuros: "0,00",
    greenLetterEuros: "0,00",
    trackedGreenLetterEuros: "0,00",
    defaultPostalProduct: "vertesuivi",
  };
}

function noticeClass(tone: "info" | "success" | "error"): string {
  if (tone === "error") return "border-[#c7472f] bg-[#fff0ec] text-[#9f3523]";
  if (tone === "success") return "border-[#087a55] bg-[#e9f5ef] text-[#2f6b53]";
  return "border-[#59766a] bg-[#f0f5f2] text-[#526058]";
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

function readPricing(value: unknown): Pricing | null {
  if (!value || typeof value !== "object") return null;
  const pricing = value as Record<string, unknown>;
  if (
    typeof pricing.serviceFeeCents !== "number" ||
    typeof pricing.printingBaseCents !== "number" ||
    typeof pricing.printingPerAdditionalPageCents !== "number" ||
    typeof pricing.greenLetterCents !== "number" ||
    typeof pricing.trackedGreenLetterCents !== "number" ||
    (pricing.defaultPostalProduct !== "verte" && pricing.defaultPostalProduct !== "vertesuivi") ||
    typeof pricing.updatedAt !== "string"
  ) return null;
  return pricing as Pricing;
}
