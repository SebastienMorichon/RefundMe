"use client";

import { AlertCircle, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AuthShell } from "../../components/auth-shell";
import { apiFetch as fetch } from "../../lib/api-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get("token") ?? "");
    window.history.replaceState(null, "", "/reinitialisation-mot-de-passe");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!token) return setMessage("Ce lien est incomplet.");
    if (password.length < 12 || password.length > 256) return setMessage("Le mot de passe doit contenir entre 12 et 256 caractères.");
    if (password !== confirmation) return setMessage("Les deux mots de passe ne correspondent pas.");
    setIsBusy(true);
    try {
      const response = await fetch(`${apiUrl}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword: password }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, "Lien invalide ou expiré."));
      setComplete(true);
      setPassword("");
      setConfirmation("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Réinitialisation impossible.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AuthShell>
      <p className="eyebrow">Lien à usage unique</p>
      <h1 className="mt-3 text-3xl font-extrabold text-[#17211d] sm:text-4xl">Choisissez un nouveau mot de passe.</h1>
      {complete ? (
        <div className="mt-8 text-center" aria-live="polite">
          <CheckCircle2 size={42} className="mx-auto text-[#16875b]" />
          <p className="mt-5 text-sm leading-6 text-[#526058]">Le mot de passe a été modifié et toutes les anciennes sessions ont été révoquées.</p>
          <a href="/connexion" className="mt-6 inline-block font-bold text-[#087a55] hover:underline">Se connecter</a>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 grid gap-5">
          {[{ label: "Nouveau mot de passe", value: password, setter: setPassword }, { label: "Confirmer le mot de passe", value: confirmation, setter: setConfirmation }].map((field) => (
            <label key={field.label} className="grid gap-2 text-sm font-bold text-[#24332c]">
              {field.label}
              <span className="relative">
                <LockKeyhole size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]" />
                <input value={field.value} onChange={(event) => field.setter(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={256} required className="field field-with-leading-icon-and-suffix" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-[#66736d]" aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </span>
            </label>
          ))}
          {message ? <div className="flex gap-3 border-l-4 border-[#e9654b] bg-[#fff0ec] p-4 text-sm text-[#8e3d2c]" role="alert"><AlertCircle size={18} />{message}</div> : null}
          <button disabled={isBusy || !token} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 text-sm font-extrabold text-white disabled:opacity-50">{isBusy ? <LoaderCircle size={17} className="animate-spin" /> : null}Enregistrer le nouveau mot de passe</button>
        </form>
      )}
    </AuthShell>
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> { try { const value: unknown = await response.json(); return value && typeof value === "object" ? (value as Record<string, unknown>) : {}; } catch { return {}; } }
function errorMessage(payload: Record<string, unknown>, fallback: string) { return typeof payload.message === "string" ? payload.message : fallback; }
