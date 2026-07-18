"use client";

import { CheckCircle2, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";

type User = { id: string; email: string; role: string };
type CustomerProfile = {
  firstName: string;
  lastName: string;
  postalAddress: string;
  postalCode: string;
  city: string;
  country: string;
  phoneNumber: string;
  operatorCustomerReference: string;
  complete: boolean;
  missingFields: string[];
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const emptyProfile: CustomerProfile = {
  firstName: "", lastName: "", postalAddress: "", postalCode: "", city: "", country: "France",
  phoneNumber: "", operatorCustomerReference: "", complete: false, missingFields: [],
};

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CustomerProfile>(emptyProfile);
  const [message, setMessage] = useState("Chargement de vos informations...");
  const [tone, setTone] = useState<"info" | "success" | "error">("info");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => { void loadProfile(); }, []);

  async function loadProfile() {
    try {
      const [sessionResponse, profileResponse] = await Promise.all([
        fetch(`${apiUrl}/auth/me`, { credentials: "include" }),
        fetch(`${apiUrl}/profile`, { credentials: "include" }),
      ]);
      const sessionPayload = await readJson(sessionResponse);
      const profilePayload = await readJson(profileResponse);
      const sessionUser = readUser(sessionPayload.user);
      const customerProfile = readProfile(profilePayload.profile);
      if (!sessionResponse.ok || !profileResponse.ok || !sessionUser || !customerProfile) {
        throw new Error(errorMessage(profilePayload, "Impossible de charger votre profil."));
      }
      setUser(sessionUser);
      setProfile(customerProfile);
      setMessage(customerProfile.complete
        ? "Votre profil est complet et peut etre utilise dans vos courriers."
        : `Completez les informations suivantes : ${customerProfile.missingFields.join(", ")}.`);
      setTone(customerProfile.complete ? "success" : "info");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "L'API Lydoc est indisponible.");
      setTone("error");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("Enregistrement securise de vos informations...");
    setTone("info");
    try {
      const response = await fetch(`${apiUrl}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: profile.firstName, lastName: profile.lastName, postalAddress: profile.postalAddress,
          postalCode: profile.postalCode, city: profile.city, country: profile.country,
          phoneNumber: profile.phoneNumber, operatorCustomerReference: profile.operatorCustomerReference,
        }),
      });
      const payload = await readJson(response);
      const savedProfile = readProfile(payload.profile);
      if (!response.ok || !savedProfile) throw new Error(errorMessage(payload, "Impossible d'enregistrer votre profil."));
      setProfile(savedProfile);
      setMessage("Votre profil est complet. Il sera automatiquement ajoute a vos demandes de remboursement.");
      setTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enregistrement impossible.");
      setTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  function update(field: keyof CustomerProfile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  return (
    <AppShell active="profile" email={user?.email} isAdmin={user?.role === "ADMIN"}>
      <div className="mx-auto max-w-[980px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <p className="text-xs font-extrabold uppercase text-[#7a8499]">Parametres du compte</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#102544]">Mes informations personnelles</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667189]">Ces informations servent uniquement a preparer vos courriers et a identifier vos demandes aupres des organisateurs.</p>

        <div className={`mt-5 flex items-start gap-3 border-l-4 p-4 text-sm ${tone === "success" ? "border-[#16875b] bg-[#eaf8f1] text-[#326950]" : tone === "error" ? "border-[#e9654b] bg-[#fff0ec] text-[#8e3d2c]" : "border-[#2457f5] bg-[#eef3ff] text-[#344f8d]"}`}>
          {tone === "success" ? <CheckCircle2 className="mt-0.5 shrink-0" size={18} /> : <ShieldCheck className="mt-0.5 shrink-0" size={18} />}
          <span>{message}</span>
        </div>

        <form onSubmit={saveProfile} className="surface mt-6 p-5 sm:p-7">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Prenom" value={profile.firstName} onChange={(value) => update("firstName", value)} autoComplete="given-name" required />
            <Field label="Nom" value={profile.lastName} onChange={(value) => update("lastName", value)} autoComplete="family-name" required />
          </div>
          <div className="mt-5"><Field label="Adresse postale" value={profile.postalAddress} onChange={(value) => update("postalAddress", value)} autoComplete="street-address" required /></div>
          <div className="mt-5 grid gap-5 sm:grid-cols-[0.7fr_1.3fr]">
            <Field label="Code postal" value={profile.postalCode} onChange={(value) => update("postalCode", value)} autoComplete="postal-code" required />
            <Field label="Ville" value={profile.city} onChange={(value) => update("city", value)} autoComplete="address-level2" required />
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Pays" value={profile.country} onChange={(value) => update("country", value)} autoComplete="country-name" required />
            <Field label="Numero de telephone participant" value={profile.phoneNumber} onChange={(value) => update("phoneNumber", value)} type="tel" autoComplete="tel" required />
          </div>
          <div className="mt-5"><Field label="Reference client operateur" value={profile.operatorCustomerReference} onChange={(value) => update("operatorCustomerReference", value)} description="Facultatif. Elle peut faciliter le traitement par votre operateur." /></div>

          <div className="mt-7 flex flex-col justify-between gap-4 border-t border-[#e2e8f0] pt-5 sm:flex-row sm:items-center">
            <p className="flex items-center gap-2 text-xs text-[#667189]"><ShieldCheck size={15} className="text-[#16875b]" />Les modifications sont journalisees.</p>
            <button disabled={isBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:opacity-50">
              {isBusy ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />} Enregistrer
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange, description, type = "text", autoComplete, required = false }: {
  label: string; value: string; onChange: (value: string) => void; description?: string;
  type?: string; autoComplete?: string; required?: boolean;
}) {
  return <label className="grid gap-2 text-sm font-bold text-[#26334f]">{label}<input value={value} onChange={(event) => onChange(event.target.value)} type={type} autoComplete={autoComplete} required={required} className="field font-normal" />{description ? <span className="text-xs font-normal leading-5 text-[#7a8499]">{description}</span> : null}</label>;
}

async function readJson(response: Response): Promise<Record<string, unknown>> { try { const value: unknown = await response.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return {}; } }
function errorMessage(payload: Record<string, unknown>, fallback: string): string { return typeof payload.message === "string" ? payload.message : fallback; }
function readUser(value: unknown): User | null { if (!value || typeof value !== "object") return null; const user = value as Record<string, unknown>; return typeof user.id === "string" && typeof user.email === "string" && typeof user.role === "string" ? { id: user.id, email: user.email, role: user.role } : null; }
function readProfile(value: unknown): CustomerProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Record<string, unknown>;
  const read = (field: string) => typeof profile[field] === "string" ? profile[field] as string : "";
  if (typeof profile.complete !== "boolean" || !Array.isArray(profile.missingFields)) return null;
  return {
    firstName: read("firstName"), lastName: read("lastName"), postalAddress: read("postalAddress"), postalCode: read("postalCode"),
    city: read("city"), country: read("country") || "France", phoneNumber: read("phoneNumber"),
    operatorCustomerReference: read("operatorCustomerReference"), complete: profile.complete,
    missingFields: profile.missingFields.filter((field): field is string => typeof field === "string"),
  };
}
