"use client";

import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../../components/auth-shell";
import { apiFetch as fetch } from "../../lib/api-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const currentLegalConsentVersion = "2026-08-03.v1";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get("token") ?? "");
    setTokenLoaded(true);
    window.history.replaceState(null, "", "/verification-email");
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!token) {
      setMessage("Ce lien de vérification est incomplet.");
      return;
    }
    if (password.length < 12 || password.length > 256) {
      setMessage("Le mot de passe doit contenir entre 12 et 256 caractères.");
      return;
    }
    if (password !== confirmation) {
      setMessage("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!consentAccepted) {
      setMessage(
        "Vous devez confirmer les conditions et la politique applicables.",
      );
      return;
    }

    setIsBusy(true);
    try {
      const response = await fetch(`${apiUrl}/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          token,
          password,
          consentAccepted: true,
          consentVersion: currentLegalConsentVersion,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, "Lien invalide ou expiré."),
        );
      }
      router.replace("/documents?bienvenue=1");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Activation impossible.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AuthShell>
      <p className="eyebrow">Activation sécurisée</p>
      <h1 className="mt-3 text-3xl font-extrabold text-[#17211d] sm:text-4xl">
        Choisissez votre mot de passe.
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#66736d]">
        Votre compte et votre session seront créés ensemble après validation de
        ce formulaire. Le lien ne peut être utilisé qu’une fois.
      </p>

      <form onSubmit={verify} className="mt-8 grid gap-5">
        <PasswordField
          label="Mot de passe"
          value={password}
          onChange={setPassword}
          show={showPassword}
          onToggle={() => setShowPassword((current) => !current)}
        />
        <label className="grid gap-2 text-sm font-bold text-[#24332c]">
          Confirmer le mot de passe
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            required
            className="field"
          />
        </label>

        <div className="flex gap-3 border-l-4 border-[#16875b] bg-[#eef9f4] p-4 text-xs leading-5 text-[#326950]">
          <ShieldCheck size={18} className="mt-0.5 shrink-0" />
          Au moins 12 caractères sont exigés. Utilisez une phrase de passe
          unique, idéalement conservée dans un gestionnaire de mots de passe.
        </div>

        <label className="flex items-start gap-3 text-xs leading-5 text-[#66736d]">
          <input
            type="checkbox"
            required
            checked={consentAccepted}
            onChange={(event) => setConsentAccepted(event.target.checked)}
            className="mt-1 h-4 w-4 accent-[#087a55]"
          />
          <span>
            Je confirme accepter les{" "}
            <a href="/cgu" target="_blank" rel="noreferrer" className="font-bold text-[#087a55] underline">
              conditions d’utilisation
            </a>{" "}
            et avoir pris connaissance de la{" "}
            <a href="/confidentialite" target="_blank" rel="noreferrer" className="font-bold text-[#087a55] underline">
              politique de confidentialité
            </a>
            .
          </span>
        </label>

        {message ? (
          <div className="flex gap-3 border-l-4 border-[#e9654b] bg-[#fff0ec] p-4 text-sm text-[#8e3d2c]" role="alert">
            <AlertCircle size={18} className="shrink-0" />
            {message}
          </div>
        ) : null}

        <button
          disabled={isBusy || !token}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 text-sm font-extrabold text-white hover:bg-[#066344] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowRight size={17} />}
          Activer mon compte
        </button>
      </form>
      {tokenLoaded && !token ? (
        <p className="mt-6 text-center text-sm text-[#8e3d2c]" role="alert">
          Ce lien ne contient aucun jeton. Recommencez depuis la{" "}
          <a href="/inscription" className="font-bold underline">page d’inscription</a>.
        </p>
      ) : null}
    </AuthShell>
  );
}

function PasswordField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-[#24332c]">
      {props.label}
      <span className="relative">
        <LockKeyhole size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]" />
        <input
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          type={props.show ? "text" : "password"}
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          className="field field-with-leading-icon-and-suffix"
        />
        <button
          type="button"
          onClick={props.onToggle}
          className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-[#66736d] hover:bg-[#edf2f8]"
          aria-label={props.show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        >
          {props.show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorMessage(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.message === "string" ? payload.message : fallback;
}
