"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import {
  apiFetch as fetch,
  clearApiCsrfToken,
} from "../../lib/api-client";

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
const accountExportResources = [
  "profile",
  "documents",
  "cases",
  "notifications",
  "audit",
] as const;
const deletionConfirmationText = "SUPPRIMER";
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isPasswordBusy, setIsPasswordBusy] = useState(false);
  const [dataRightsMessage, setDataRightsMessage] = useState("");
  const [isExportBusy, setIsExportBusy] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [isDeletionBusy, setIsDeletionBusy] = useState(false);

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

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage("");
    if (newPassword.length < 12 || newPassword.length > 256) {
      setPasswordMessage("Le nouveau mot de passe doit contenir entre 12 et 256 caractères.");
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setPasswordMessage("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setIsPasswordBusy(true);
    try {
      const response = await fetch(`${apiUrl}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, "Modification impossible."));
      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirmation("");
      setPasswordMessage("Mot de passe modifié. Vos autres sessions ont été révoquées.");
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : "Modification impossible.");
    } finally {
      setIsPasswordBusy(false);
    }
  }

  async function exportAccountData() {
    if (isExportBusy) return;
    setIsExportBusy(true);
    setDataRightsMessage("");
    try {
      const resources: Record<string, unknown[]> = {};
      for (const resource of accountExportResources) {
        const items: unknown[] = [];
        let cursor: string | null = null;
        const seenCursors = new Set<string>();
        for (let page = 0; page < 1_000; page += 1) {
          const query = new URLSearchParams({ resource, limit: "100" });
          if (cursor) query.set("cursor", cursor);
          const response = await fetch(
            `${apiUrl}/auth/account/export?${query.toString()}`,
            { credentials: "include", cache: "no-store" },
          );
          const payload = await readJson(response);
          if (!response.ok || !Array.isArray(payload.items)) {
            throw new Error(
              errorMessage(payload, "Impossible de préparer votre export."),
            );
          }
          items.push(...payload.items);
          const nextCursor =
            typeof payload.nextCursor === "string"
              ? payload.nextCursor
              : null;
          if (!nextCursor) break;
          if (seenCursors.has(nextCursor) || page === 999) {
            throw new Error("La pagination de l’export est incohérente.");
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
        resources[resource] = items;
      }

      downloadJson(
        `lydoc-export-${new Date().toISOString().slice(0, 10)}.json`,
        {
          format: "lydoc-account-export.v1",
          generatedAt: new Date().toISOString(),
          resources,
        },
      );
      setDataRightsMessage("Votre export JSON a été généré sur cet appareil.");
    } catch (error) {
      setDataRightsMessage(
        error instanceof Error ? error.message : "Export impossible.",
      );
    } finally {
      setIsExportBusy(false);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      deletionConfirmation.trim().toUpperCase() !== deletionConfirmationText
    ) {
      setDataRightsMessage(
        `Saisissez ${deletionConfirmationText} pour confirmer la demande.`,
      );
      return;
    }
    setIsDeletionBusy(true);
    setDataRightsMessage("");
    try {
      const response = await fetch(`${apiUrl}/auth/account/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: deletionPassword }),
      });
      const payload = await readJson(response);
      if (!response.ok || payload.deleted !== true) {
        throw new Error(
          errorMessage(payload, "La suppression du compte a échoué."),
        );
      }
      clearApiCsrfToken();
      window.location.assign("/connexion?compte-supprime=1");
    } catch (error) {
      setDataRightsMessage(
        error instanceof Error
          ? error.message
          : "La suppression du compte a échoué.",
      );
      setIsDeletionBusy(false);
    }
  }

  return (
    <AppShell active="profile" email={user?.email} isAdmin={user?.role === "ADMIN"}>
      <div className="mx-auto max-w-[980px] px-4 py-7 sm:px-7 lg:px-9 lg:py-9">
        <p className="text-xs font-extrabold uppercase text-[#7b8781]">Parametres du compte</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#17211d]">Mes informations personnelles</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736d]">Ces informations servent uniquement a preparer vos courriers et a identifier vos demandes aupres des organisateurs.</p>

        <div className={`mt-5 flex items-start gap-3 border-l-4 p-4 text-sm ${tone === "success" ? "border-[#16875b] bg-[#eaf8f1] text-[#326950]" : tone === "error" ? "border-[#e9654b] bg-[#fff0ec] text-[#8e3d2c]" : "border-[#087a55] bg-[#e9f5ef] text-[#2f6b53]"}`}>
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
            <p className="flex items-center gap-2 text-xs text-[#66736d]"><ShieldCheck size={15} className="text-[#16875b]" />Les modifications sont journalisees.</p>
            <button disabled={isBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 text-sm font-extrabold text-white hover:bg-[#066344] disabled:opacity-50">
              {isBusy ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />} Enregistrer
            </button>
          </div>
        </form>

        <form onSubmit={changePassword} className="surface mt-6 p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#e4f3eb] text-[#087a55]"><KeyRound size={20} /></span>
            <div>
              <h2 className="text-lg font-extrabold text-[#17211d]">Modifier mon mot de passe</h2>
              <p className="mt-1 text-xs leading-5 text-[#66736d]">La session utilisée ici restera active; toutes vos autres sessions seront révoquées.</p>
            </div>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            <Field label="Mot de passe actuel" value={currentPassword} onChange={setCurrentPassword} type="password" autoComplete="current-password" required />
            <Field label="Nouveau mot de passe" value={newPassword} onChange={setNewPassword} type="password" autoComplete="new-password" required />
            <Field label="Confirmer" value={passwordConfirmation} onChange={setPasswordConfirmation} type="password" autoComplete="new-password" required />
          </div>
          {passwordMessage ? <p className="mt-4 text-sm font-semibold text-[#526058]" role="status">{passwordMessage}</p> : null}
          <div className="mt-5 flex justify-end border-t border-[#e2e8f0] pt-5">
            <button disabled={isPasswordBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 text-sm font-extrabold text-white hover:bg-[#066344] disabled:opacity-50">
              {isPasswordBusy ? <LoaderCircle size={17} className="animate-spin" /> : <KeyRound size={17} />} Modifier le mot de passe
            </button>
          </div>
        </form>

        <section className="surface mt-6 p-5 sm:p-7" aria-labelledby="data-rights-title">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#e4f3eb] text-[#087a55]">
              <Download size={20} />
            </span>
            <div>
              <h2 id="data-rights-title" className="text-lg font-extrabold text-[#17211d]">
                Mes données et mon compte
              </h2>
              <p className="mt-1 text-xs leading-5 text-[#66736d]">
                Téléchargez une copie structurée de vos informations ou demandez la suppression de votre compte.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-md border border-[#dce6e1] bg-[#f8fbf9] p-4">
            <h3 className="text-sm font-extrabold text-[#24332c]">Exporter mes données</h3>
            <p className="mt-1 text-xs leading-5 text-[#66736d]">
              L’export JSON contient votre profil, les métadonnées de documents, vos dossiers, notifications et événements d’audit. Les secrets techniques ne sont jamais inclus.
            </p>
            <button
              type="button"
              onClick={() => void exportAccountData()}
              disabled={isExportBusy || isDeletionBusy}
              className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#087a55] px-4 text-sm font-extrabold text-[#087a55] hover:bg-[#eaf8f1] disabled:opacity-50"
            >
              {isExportBusy ? (
                <LoaderCircle size={17} className="animate-spin" />
              ) : (
                <Download size={17} />
              )}
              Télécharger mon export
            </button>
          </div>

          <form
            onSubmit={deleteAccount}
            className="mt-5 rounded-md border border-[#efc8bf] bg-[#fff8f6] p-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-[#c64d36]" size={19} />
              <div>
                <h3 className="text-sm font-extrabold text-[#8e3d2c]">Supprimer mon compte</h3>
                <p className="mt-1 text-xs leading-5 text-[#74483e]">
                  Cette action révoque vos sessions, anonymise votre profil et programme la purge des fichiers qui ne doivent pas être conservés. Les écritures strictement nécessaires à une obligation légale ou à une transaction peuvent rester pseudonymisées pendant leur durée de conservation.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Mot de passe actuel"
                value={deletionPassword}
                onChange={setDeletionPassword}
                type="password"
                autoComplete="current-password"
                required
              />
              <Field
                label={`Saisissez ${deletionConfirmationText}`}
                value={deletionConfirmation}
                onChange={setDeletionConfirmation}
                autoComplete="off"
                required
              />
            </div>
            <button
              disabled={
                isDeletionBusy ||
                isExportBusy ||
                deletionConfirmation.trim().toUpperCase() !==
                  deletionConfirmationText
              }
              className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#b74330] px-4 text-sm font-extrabold text-white hover:bg-[#963725] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeletionBusy ? (
                <LoaderCircle size={17} className="animate-spin" />
              ) : (
                <Trash2 size={17} />
              )}
              Supprimer définitivement mon compte
            </button>
          </form>

          {dataRightsMessage ? (
            <p className="mt-4 text-sm font-semibold text-[#526058]" role="status">
              {dataRightsMessage}
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange, description, type = "text", autoComplete, required = false }: {
  label: string; value: string; onChange: (value: string) => void; description?: string;
  type?: string; autoComplete?: string; required?: boolean;
}) {
  return <label className="grid gap-2 text-sm font-bold text-[#24332c]">{label}<input value={value} onChange={(event) => onChange(event.target.value)} type={type} autoComplete={autoComplete} required={required} className="field font-normal" />{description ? <span className="text-xs font-normal leading-5 text-[#7b8781]">{description}</span> : null}</label>;
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
