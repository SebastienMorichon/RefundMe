"use client";

import { AlertCircle, CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { AuthShell } from "../../components/auth-shell";
import { apiFetch as fetch } from "../../lib/api-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, "Demande impossible."));
      setSent(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Demande impossible.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AuthShell>
      <p className="eyebrow">Récupération du compte</p>
      <h1 className="mt-3 text-3xl font-extrabold text-[#17211d] sm:text-4xl">
        Réinitialisez votre mot de passe.
      </h1>
      {sent ? (
        <div className="mt-8 text-center" aria-live="polite">
          <CheckCircle2 size={42} className="mx-auto text-[#16875b]" />
          <p className="mt-5 text-sm leading-6 text-[#526058]">
            Si cette adresse correspond à un compte vérifié, un lien à usage
            unique valable 30 minutes vient d’être envoyé.
          </p>
          <a href="/connexion" className="mt-6 inline-block font-bold text-[#087a55] hover:underline">
            Revenir à la connexion
          </a>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 grid gap-5">
          <label className="grid gap-2 text-sm font-bold text-[#24332c]">
            Adresse e-mail
            <span className="relative">
              <Mail size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]" />
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" maxLength={254} required className="field field-with-leading-icon" />
            </span>
          </label>
          {message ? <div className="flex gap-3 border-l-4 border-[#e9654b] bg-[#fff0ec] p-4 text-sm text-[#8e3d2c]" role="alert"><AlertCircle size={18} />{message}</div> : null}
          <button disabled={isBusy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 text-sm font-extrabold text-white disabled:opacity-60">
            {isBusy ? <LoaderCircle size={17} className="animate-spin" /> : null}
            Envoyer le lien sécurisé
          </button>
        </form>
      )}
    </AuthShell>
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try { const value: unknown = await response.json(); return value && typeof value === "object" ? (value as Record<string, unknown>) : {}; } catch { return {}; }
}
function errorMessage(payload: Record<string, unknown>, fallback: string) { return typeof payload.message === "string" ? payload.message : fallback; }
