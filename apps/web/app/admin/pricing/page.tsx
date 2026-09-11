"use client";

import {
  BadgeEuro,
  CheckCircle2,
  LoaderCircle,
  Plus,
  ReceiptText,
  Save,
  Tag,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { apiFetch as fetch } from "../../../lib/api-client";

type SessionUser = { id: string; email: string; role: string };
type PostalProduct = "verte" | "vertesuivi";
type DiscountType = "FIXED_AMOUNT" | "PERCENTAGE";
type Pricing = {
  paymentEnabled: boolean;
  serviceFeeCents: number;
  printingBaseCents: number;
  printingPerAdditionalPageCents: number;
  greenLetterCents: number;
  managedPostageCents: number;
  trackedGreenLetterCents: number;
  defaultPostalProduct: PostalProduct;
  promotionEnabled: boolean;
  promotionLabel: string | null;
  promotionDiscountType: DiscountType | null;
  promotionDiscountValue: number;
  promotionStartsAt: string | null;
  promotionEndsAt: string | null;
  updatedAt: string;
};
type PromoCode = {
  id: string;
  code: string;
  label: string;
  discountType: DiscountType;
  discountValue: number;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
};
type PricingForm = {
  paymentEnabled: boolean;
  serviceFeeEuros: string;
  printingBaseEuros: string;
  printingPerAdditionalPageEuros: string;
  greenLetterEuros: string;
  managedPostageEuros: string;
  trackedGreenLetterEuros: string;
  defaultPostalProduct: PostalProduct;
  promotionEnabled: boolean;
  promotionLabel: string;
  promotionDiscountType: DiscountType;
  promotionDiscountValue: string;
  promotionStartsAt: string;
  promotionEndsAt: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const samplePageCount = 6;

export default function AdminPricingPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [form, setForm] = useState<PricingForm>(emptyForm());
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [newCode, setNewCode] = useState({
    code: "",
    label: "",
    discountType: "FIXED_AMOUNT" as DiscountType,
    value: "",
    startsAt: "",
    endsAt: "",
  });
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("Vérification de votre accès administrateur...");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => { void loadPage(); }, []);
  const preview = useMemo(() => calculatePreview(form), [form]);

  async function loadPage() {
    try {
      const sessionResponse = await fetch(`${apiUrl}/auth/me`, { credentials: "include" });
      const sessionPayload = await readJson(sessionResponse);
      const sessionUser = readUser(sessionPayload.user);
      if (!sessionResponse.ok || !sessionUser || sessionUser.role !== "ADMIN") {
        setMessage("Connectez-vous avec un compte administrateur.");
        setMessageTone("error");
        return;
      }
      setUser(sessionUser);
      const response = await fetch(`${apiUrl}/admin/pricing`, { credentials: "include" });
      const payload = await readJson(response);
      const pricing = readPricing(payload.pricing);
      if (!response.ok || !pricing) throw new Error(errorMessage(payload, "Impossible de charger les tarifs."));
      hydrate(pricing);
      setPromoCodes(readPromoCodes(payload.promoCodes));
      setMessage(pricing.paymentEnabled ? "Paiement SumUp ouvert aux clients." : "Paiement désactivé : vous gardez la main sur le lancement.");
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
      setMessage("Vérifiez les montants et les dates saisis.");
      setMessageTone("error");
      return;
    }
    setIsBusy(true);
    setMessage("Enregistrement des réglages...");
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
      if (!response.ok || !pricing) throw new Error(errorMessage(payload, "Impossible d'enregistrer les réglages."));
      hydrate(pricing);
      setMessage(pricing.paymentEnabled ? "Réglages enregistrés et paiement ouvert." : "Réglages enregistrés. Le paiement reste fermé.");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enregistrement impossible.");
      setMessageTone("error");
    } finally { setIsBusy(false); }
  }

  async function createPromoCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const discountValue = discountInputToInteger(newCode.value, newCode.discountType);
    if (!newCode.code.trim() || !newCode.label.trim() || discountValue === null) {
      setMessage("Complétez le code, son libellé et sa remise.");
      setMessageTone("error");
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch(`${apiUrl}/admin/pricing/promo-codes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newCode.code,
          label: newCode.label,
          discountType: newCode.discountType,
          discountValue,
          enabled: true,
          startsAt: localDateToIso(newCode.startsAt),
          endsAt: localDateToIso(newCode.endsAt),
        }),
      });
      const payload = await readJson(response);
      const promoCode = readPromoCode(payload.promoCode);
      if (!response.ok || !promoCode) throw new Error(errorMessage(payload, "Création du code impossible."));
      setPromoCodes((current) => [promoCode, ...current]);
      setNewCode({ code: "", label: "", discountType: "FIXED_AMOUNT", value: "", startsAt: "", endsAt: "" });
      setMessage(`Code ${promoCode.code} créé.`);
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Création du code impossible.");
      setMessageTone("error");
    } finally { setIsBusy(false); }
  }

  async function togglePromoCode(promoCode: PromoCode) {
    setIsBusy(true);
    try {
      const response = await fetch(`${apiUrl}/admin/pricing/promo-codes/${promoCode.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...promoCode, enabled: !promoCode.enabled }),
      });
      const payload = await readJson(response);
      const saved = readPromoCode(payload.promoCode);
      if (!response.ok || !saved) throw new Error(errorMessage(payload, "Modification impossible."));
      setPromoCodes((current) => current.map((item) => item.id === saved.id ? saved : item));
      setMessage(`Code ${saved.code} ${saved.enabled ? "activé" : "désactivé"}.`);
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Modification impossible.");
      setMessageTone("error");
    } finally { setIsBusy(false); }
  }

  function hydrate(pricing: Pricing) {
    setForm({
      paymentEnabled: pricing.paymentEnabled,
      serviceFeeEuros: centsToInput(pricing.serviceFeeCents),
      printingBaseEuros: centsToInput(pricing.printingBaseCents),
      printingPerAdditionalPageEuros: centsToInput(pricing.printingPerAdditionalPageCents),
      greenLetterEuros: centsToInput(pricing.greenLetterCents),
      managedPostageEuros: centsToInput(pricing.managedPostageCents),
      trackedGreenLetterEuros: centsToInput(pricing.trackedGreenLetterCents),
      defaultPostalProduct: pricing.defaultPostalProduct,
      promotionEnabled: pricing.promotionEnabled,
      promotionLabel: pricing.promotionLabel ?? "",
      promotionDiscountType: pricing.promotionDiscountType ?? "FIXED_AMOUNT",
      promotionDiscountValue: discountToInput(pricing.promotionDiscountValue, pricing.promotionDiscountType ?? "FIXED_AMOUNT"),
      promotionStartsAt: isoToLocalDate(pricing.promotionStartsAt),
      promotionEndsAt: isoToLocalDate(pricing.promotionEndsAt),
    });
    setUpdatedAt(pricing.updatedAt);
  }

  return (
    <AppShell active="admin-pricing" email={user?.email} isAdmin>
      <div className="mx-auto max-w-[1180px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <p className="text-xs font-extrabold uppercase text-[#7b8781]">Administration</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">Paiement et tarification</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736d]">
          Pilotez l’ouverture de SumUp, vos frais et vos opérations commerciales.
        </p>
        <div className={`mt-5 border-l-4 p-4 text-sm ${noticeClass(messageTone)}`}>{message}</div>

        {user?.role === "ADMIN" ? (
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="grid gap-6">
              <form onSubmit={savePricing} className="surface overflow-hidden">
                <section className="border-b border-[#e3e9e6] p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-5">
                    <div>
                      <h2 className="font-extrabold text-[#17211d]">Paiement SumUp</h2>
                      <p className="mt-1 text-xs leading-5 text-[#66736d]">Ce bouton ouvre ou ferme immédiatement les nouveaux devis payants.</p>
                    </div>
                    <ToggleButton active={form.paymentEnabled} onClick={() => setForm((current) => ({ ...current, paymentEnabled: !current.paymentEnabled }))} label="paiement" />
                  </div>
                </section>

                <FormSection icon={<BadgeEuro size={20} />} title="Tarifs">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <MoneyField label="Frais de service" value={form.serviceFeeEuros} onChange={(value) => setForm((current) => ({ ...current, serviceFeeEuros: value }))} />
                    <MoneyField label="Première page" value={form.printingBaseEuros} onChange={(value) => setForm((current) => ({ ...current, printingBaseEuros: value }))} />
                    <MoneyField label="Page supplémentaire" value={form.printingPerAdditionalPageEuros} onChange={(value) => setForm((current) => ({ ...current, printingPerAdditionalPageEuros: value }))} />
                    <MoneyField label="Timbre vert remboursable" value={form.greenLetterEuros} onChange={(value) => setForm((current) => ({ ...current, greenLetterEuros: value }))} />
                    <MoneyField label="e-Lettre rouge facturée" value={form.managedPostageEuros} onChange={(value) => setForm((current) => ({ ...current, managedPostageEuros: value }))} />
                    <MoneyField label="Lettre verte suivie" value={form.trackedGreenLetterEuros} onChange={(value) => setForm((current) => ({ ...current, trackedGreenLetterEuros: value }))} />
                    <SelectField label="Mode proposé" value={form.defaultPostalProduct} onChange={(value) => setForm((current) => ({ ...current, defaultPostalProduct: value as PostalProduct }))} options={[{ value: "verte", label: "e-Lettre rouge" }, { value: "vertesuivi", label: "Envoi suivi" }]} />
                  </div>
                </FormSection>

                <FormSection icon={<Tag size={20} />} title="Promotion générale">
                  <div className="mb-4 flex items-center justify-between rounded-md bg-[#f5f8f6] p-3">
                    <span className="text-sm font-bold text-[#405048]">Appliquer automatiquement</span>
                    <ToggleButton active={form.promotionEnabled} onClick={() => setForm((current) => ({ ...current, promotionEnabled: !current.promotionEnabled }))} label="promotion" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Nom de l’opération" value={form.promotionLabel} onChange={(value) => setForm((current) => ({ ...current, promotionLabel: value }))} placeholder="Offre de lancement" />
                    <DiscountFields type={form.promotionDiscountType} value={form.promotionDiscountValue} onType={(value) => setForm((current) => ({ ...current, promotionDiscountType: value, promotionDiscountValue: "" }))} onValue={(value) => setForm((current) => ({ ...current, promotionDiscountValue: value }))} />
                    <DateField label="Début facultatif" value={form.promotionStartsAt} onChange={(value) => setForm((current) => ({ ...current, promotionStartsAt: value }))} />
                    <DateField label="Fin facultative" value={form.promotionEndsAt} onChange={(value) => setForm((current) => ({ ...current, promotionEndsAt: value }))} />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[#66736d]">La remise porte uniquement sur les frais de service et ne se cumule pas avec un code.</p>
                </FormSection>

                <div className="flex items-center justify-between gap-4 border-t border-[#e3e9e6] bg-[#fafcfb] px-5 py-5 sm:px-6">
                  <p className="text-xs text-[#66736d]">{updatedAt ? `Modifié le ${formatDate(updatedAt)}` : "Configuration initiale"}</p>
                  <button type="submit" disabled={isBusy} className="primary-button min-w-[180px]">
                    {isBusy ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />} Enregistrer
                  </button>
                </div>
              </form>

              <section className="surface overflow-hidden">
                <div className="border-b border-[#e3e9e6] p-5 sm:p-6">
                  <h2 className="font-extrabold text-[#17211d]">Codes promotionnels</h2>
                  <p className="mt-1 text-xs leading-5 text-[#66736d]">Créez un code puis activez-le ou suspendez-le à tout moment.</p>
                </div>
                <form onSubmit={createPromoCode} className="grid gap-4 border-b border-[#e3e9e6] bg-[#fafcfb] p-5 sm:grid-cols-2 sm:p-6">
                  <TextField label="Code" value={newCode.code} onChange={(value) => setNewCode((current) => ({ ...current, code: value.toUpperCase() }))} placeholder="BIENVENUE" />
                  <TextField label="Libellé client" value={newCode.label} onChange={(value) => setNewCode((current) => ({ ...current, label: value }))} placeholder="Offre bienvenue" />
                  <DiscountFields type={newCode.discountType} value={newCode.value} onType={(value) => setNewCode((current) => ({ ...current, discountType: value, value: "" }))} onValue={(value) => setNewCode((current) => ({ ...current, value }))} />
                  <div />
                  <DateField label="Début facultatif" value={newCode.startsAt} onChange={(value) => setNewCode((current) => ({ ...current, startsAt: value }))} />
                  <DateField label="Fin facultative" value={newCode.endsAt} onChange={(value) => setNewCode((current) => ({ ...current, endsAt: value }))} />
                  <button disabled={isBusy} className="primary-button sm:col-span-2"><Plus size={17} /> Créer le code</button>
                </form>
                <div className="divide-y divide-[#e3e9e6]">
                  {promoCodes.length ? promoCodes.map((code) => (
                    <div key={code.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
                      <div>
                        <p className="font-extrabold text-[#24332c]">{code.code} <span className="ml-2 text-xs font-semibold text-[#66736d]">{code.label}</span></p>
                        <p className="mt-1 text-xs text-[#66736d]">{formatDiscount(code.discountType, code.discountValue)} sur les frais de service{formatPeriod(code.startsAt, code.endsAt)}</p>
                      </div>
                      <ToggleButton active={code.enabled} onClick={() => void togglePromoCode(code)} label={`code ${code.code}`} />
                    </div>
                  )) : <p className="p-6 text-sm text-[#66736d]">Aucun code créé.</p>}
                </div>
              </section>
            </div>

            <aside className="surface overflow-hidden lg:sticky lg:top-24">
              <div className="border-b border-[#e3e9e6] px-5 py-5">
                <ReceiptText className="text-[#087a55]" size={22} />
                <p className="mt-3 text-xs font-extrabold uppercase text-[#7b8781]">Simulation</p>
                <h2 className="mt-1 text-lg font-extrabold text-[#17211d]">Courrier de {samplePageCount} pages</h2>
              </div>
              <dl className="divide-y divide-[#e3e9e6] px-5">
                <SummaryLine label="Service" cents={preview.serviceFeeCents} />
                {preview.discountCents ? <SummaryLine label="Promotion" cents={-preview.discountCents} /> : null}
                <SummaryLine label="Impression" cents={preview.printingCents} />
                <SummaryLine label="Affranchissement" cents={preview.postageCents} />
                <SummaryLine label="Total client" cents={preview.totalCents} strong />
              </dl>
              <div className="flex gap-3 border-t border-[#e3e9e6] bg-[#f2f8f5] px-5 py-4 text-xs leading-5 text-[#426452]">
                <CheckCircle2 className="shrink-0 text-[#087a55]" size={16} /> Le devis fige le tarif et la remise.
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function FormSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="grid gap-5 border-b border-[#e3e9e6] px-5 py-6 sm:grid-cols-[170px_1fr] sm:px-6"><div><span className="grid h-10 w-10 place-items-center rounded-md bg-[#e9f5ef] text-[#087a55]">{icon}</span><h2 className="mt-3 font-extrabold text-[#17211d]">{title}</h2></div><div>{children}</div></section>;
}
function ToggleButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} aria-label={`${active ? "Désactiver" : "Activer"} ${label}`} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-extrabold ${active ? "bg-[#e8f6ef] text-[#087a55]" : "bg-[#edf1ef] text-[#66736d]"}`}>{active ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}{active ? "Activé" : "Désactivé"}</button>;
}
function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="grid gap-2 text-sm font-extrabold text-[#24332c]">{label}<input className="field" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={120} /></label>;
}
function MoneyField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2 text-sm font-extrabold text-[#24332c]">{props.label}<span className="relative"><input className="field pr-10" inputMode="decimal" value={props.value} onChange={(event) => props.onChange(event.target.value)} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#66736d]">€</span></span></label>;
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="grid gap-2 text-sm font-extrabold text-[#24332c]">{label}<select className="field" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function DiscountFields({ type, value, onType, onValue }: { type: DiscountType; value: string; onType: (value: DiscountType) => void; onValue: (value: string) => void }) {
  return <div className="grid grid-cols-[1fr_110px] gap-2"><SelectField label="Type de remise" value={type} onChange={(value) => onType(value as DiscountType)} options={[{ value: "FIXED_AMOUNT", label: "Montant" }, { value: "PERCENTAGE", label: "Pourcentage" }]} /><label className="grid gap-2 text-sm font-extrabold text-[#24332c]">Valeur<span className="relative"><input className="field pr-9" inputMode="decimal" value={value} onChange={(event) => onValue(event.target.value)} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#66736d]">{type === "PERCENTAGE" ? "%" : "€"}</span></span></label></div>;
}
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2 text-sm font-extrabold text-[#24332c]">{label}<input type="datetime-local" className="field" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function SummaryLine({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return <div className={`flex justify-between gap-4 py-3 text-sm ${strong ? "font-extrabold text-[#17211d]" : "text-[#526058]"}`}><dt>{label}</dt><dd>{formatCents(cents)}</dd></div>;
}

function emptyForm(): PricingForm {
  return { paymentEnabled: false, serviceFeeEuros: "0,99", printingBaseEuros: "0,30", printingPerAdditionalPageEuros: "0,30", greenLetterEuros: "1,52", managedPostageEuros: "1,60", trackedGreenLetterEuros: "2,02", defaultPostalProduct: "verte", promotionEnabled: false, promotionLabel: "", promotionDiscountType: "FIXED_AMOUNT", promotionDiscountValue: "", promotionStartsAt: "", promotionEndsAt: "" };
}
function formToPayload(form: PricingForm): Record<string, unknown> | null {
  const amounts = [form.serviceFeeEuros, form.printingBaseEuros, form.printingPerAdditionalPageEuros, form.greenLetterEuros, form.managedPostageEuros, form.trackedGreenLetterEuros].map(eurosToCents);
  if (amounts.some((value) => value === null)) return null;
  const discount = form.promotionEnabled ? discountInputToInteger(form.promotionDiscountValue, form.promotionDiscountType) : 0;
  if (discount === null) return null;
  return { paymentEnabled: form.paymentEnabled, serviceFeeCents: amounts[0], printingBaseCents: amounts[1], printingPerAdditionalPageCents: amounts[2], greenLetterCents: amounts[3], managedPostageCents: amounts[4], trackedGreenLetterCents: amounts[5], defaultPostalProduct: form.defaultPostalProduct, promotionEnabled: form.promotionEnabled, promotionLabel: form.promotionEnabled ? form.promotionLabel : null, promotionDiscountType: form.promotionEnabled ? form.promotionDiscountType : null, promotionDiscountValue: discount, promotionStartsAt: localDateToIso(form.promotionStartsAt), promotionEndsAt: localDateToIso(form.promotionEndsAt) };
}
function calculatePreview(form: PricingForm) {
  const service = eurosToCents(form.serviceFeeEuros) ?? 0;
  const discountValue = form.promotionEnabled ? discountInputToInteger(form.promotionDiscountValue, form.promotionDiscountType) ?? 0 : 0;
  const discountCents = form.promotionDiscountType === "PERCENTAGE" ? Math.round(service * discountValue / 100) : discountValue;
  const printing = (eurosToCents(form.printingBaseEuros) ?? 0) + (samplePageCount - 1) * (eurosToCents(form.printingPerAdditionalPageEuros) ?? 0);
  const postage = eurosToCents(form.defaultPostalProduct === "verte" ? form.managedPostageEuros : form.trackedGreenLetterEuros) ?? 0;
  return { serviceFeeCents: service, discountCents: Math.min(service, discountCents), printingCents: printing, postageCents: postage, totalCents: Math.max(0, service - discountCents) + printing + postage };
}
function eurosToCents(value: string): number | null { const normalized = value.trim().replace(",", "."); if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null; const amount = Number(normalized); return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null; }
function discountInputToInteger(value: string, type: DiscountType): number | null { return type === "PERCENTAGE" ? (/^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100 ? Number(value) : null) : eurosToCents(value); }
function centsToInput(value: number) { return (value / 100).toFixed(2).replace(".", ","); }
function discountToInput(value: number, type: DiscountType) { return type === "PERCENTAGE" ? String(value || "") : value ? centsToInput(value) : ""; }
function localDateToIso(value: string): string | null { return value ? new Date(value).toISOString() : null; }
function isoToLocalDate(value: string | null): string { if (!value) return ""; const date = new Date(value); const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return shifted.toISOString().slice(0, 16); }
function formatCents(cents: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100); }
function formatDiscount(type: DiscountType, value: number) { return type === "PERCENTAGE" ? `${value} %` : formatCents(value); }
function formatPeriod(start: string | null, end: string | null) { if (!start && !end) return ""; return ` · ${start ? `du ${formatDate(start)}` : "dès maintenant"}${end ? ` au ${formatDate(end)}` : ""}`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function noticeClass(tone: "info" | "success" | "error") { return tone === "success" ? "border-[#087a55] bg-[#eaf7f1] text-[#315f4c]" : tone === "error" ? "border-[#d9482f] bg-[#fff0ec] text-[#8e3d2c]" : "border-[#5b7cfa] bg-[#eef3ff] text-[#3851a5]"; }
async function readJson(response: Response): Promise<Record<string, unknown>> { try { const value: unknown = await response.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return {}; } }
function errorMessage(payload: Record<string, unknown>, fallback: string) { return typeof payload.message === "string" ? payload.message : fallback; }
function readUser(value: unknown): SessionUser | null { return value && typeof value === "object" && typeof (value as SessionUser).id === "string" && typeof (value as SessionUser).email === "string" && typeof (value as SessionUser).role === "string" ? value as SessionUser : null; }
function readPricing(value: unknown): Pricing | null { if (!value || typeof value !== "object") return null; const p = value as Record<string, unknown>; return typeof p.paymentEnabled === "boolean" && typeof p.serviceFeeCents === "number" && typeof p.printingBaseCents === "number" && typeof p.printingPerAdditionalPageCents === "number" && typeof p.greenLetterCents === "number" && typeof p.managedPostageCents === "number" && typeof p.trackedGreenLetterCents === "number" && (p.defaultPostalProduct === "verte" || p.defaultPostalProduct === "vertesuivi") && typeof p.promotionEnabled === "boolean" && typeof p.promotionDiscountValue === "number" && typeof p.updatedAt === "string" ? p as Pricing : null; }
function readPromoCode(value: unknown): PromoCode | null { if (!value || typeof value !== "object") return null; const p = value as Record<string, unknown>; return typeof p.id === "string" && typeof p.code === "string" && typeof p.label === "string" && (p.discountType === "FIXED_AMOUNT" || p.discountType === "PERCENTAGE") && typeof p.discountValue === "number" && typeof p.enabled === "boolean" ? p as PromoCode : null; }
function readPromoCodes(value: unknown): PromoCode[] { return Array.isArray(value) ? value.flatMap((item) => { const parsed = readPromoCode(item); return parsed ? [parsed] : []; }) : []; }
