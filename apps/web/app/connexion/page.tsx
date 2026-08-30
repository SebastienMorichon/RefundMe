"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { AuthShell } from "../../components/auth-shell";
import { apiFetch as fetch } from "../../lib/api-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallengeToken, setMfaChallengeToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("");
    try {
      const verifyingMfa = Boolean(mfaChallengeToken);
      const response = await fetch(
        `${apiUrl}${verifyingMfa ? "/auth/mfa/verify" : "/auth/login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            verifyingMfa
              ? { challengeToken: mfaChallengeToken, code: mfaCode }
              : { email, password },
          ),
        },
      );
      const payload = await readJson(response);

      if (
        !verifyingMfa &&
        response.status === 401 &&
        payload.code === "MFA_REQUIRED" &&
        typeof payload.mfaChallengeToken === "string" &&
        payload.mfaChallengeToken.length >= 32
      ) {
        setMfaChallengeToken(payload.mfaChallengeToken);
        setMfaCode("");
        setPassword("");
        return;
      }
      if (!response.ok) {
        throw new Error(
          errorMessage(
            payload,
            verifyingMfa
              ? "Code de sécurité invalide ou expiré."
              : "Adresse e-mail ou mot de passe incorrect.",
          ),
        );
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof TypeError
          ? "Le service est momentanément indisponible. Vérifiez que l’API Lydoc est démarrée."
          : error instanceof Error
            ? error.message
            : "Connexion impossible.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  function cancelMfa() {
    setMfaChallengeToken("");
    setMfaCode("");
    setMessage("");
  }

  const verifyingMfa = Boolean(mfaChallengeToken);

  return (
    <AuthShell>
      <p className="eyebrow">
        {verifyingMfa ? "Vérification renforcée" : "Heureux de vous revoir"}
      </p>
      <h1 className="mt-3 text-3xl font-extrabold text-[#17211d] sm:text-4xl">
        {verifyingMfa
          ? "Confirmez votre identité."
          : "Connectez-vous à Lydoc."}
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#66736d]">
        {verifyingMfa
          ? `Saisissez le code temporaire de votre application d’authentification pour ${email}.`
          : "Retrouvez vos analyses, vos documents et l’avancement de vos dossiers."}
      </p>

      <form onSubmit={login} className="mt-8 grid gap-5">
        {verifyingMfa ? (
          <label className="grid gap-2 text-sm font-bold text-[#24332c]">
            Code de sécurité à 6 chiffres
            <span className="relative">
              <ShieldCheck
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]"
              />
              <input
                value={mfaCode}
                onChange={(event) =>
                  setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                autoFocus
                className="field field-with-leading-icon font-mono tracking-[0.3em]"
                placeholder="000000"
              />
            </span>
          </label>
        ) : (
          <>
            <label className="grid gap-2 text-sm font-bold text-[#24332c]">
              Adresse e-mail
              <span className="relative">
                <Mail
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]"
                />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                  className="field field-with-leading-icon"
                  placeholder="vous@exemple.fr"
                />
              </span>
            </label>
            <label className="grid gap-2 text-sm font-bold text-[#24332c]">
              <span className="flex items-center justify-between">
                <span>Mot de passe</span>
                <a
                  href="/mot-de-passe-oublie"
                  className="text-xs font-bold text-[#087a55] hover:underline"
                >
                  Mot de passe oublié ?
                </a>
              </span>
              <span className="relative">
                <LockKeyhole
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]"
                />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="field field-with-leading-icon-and-suffix"
                  placeholder="Votre mot de passe"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-[#66736d] hover:bg-[#edf2f8]"
                  aria-label={
                    showPassword
                      ? "Masquer le mot de passe"
                      : "Afficher le mot de passe"
                  }
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          </>
        )}

        {message ? (
          <div
            className="flex gap-3 border-l-4 border-[#e9654b] bg-[#fff0ec] p-4 text-sm leading-6 text-[#8e3d2c]"
            role="alert"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            {message}
          </div>
        ) : null}

        <button
          disabled={isBusy || (verifyingMfa && mfaCode.length !== 6)}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#066344] disabled:cursor-wait disabled:opacity-60"
        >
          {isBusy
            ? "Connexion…"
            : verifyingMfa
              ? "Valider le code"
              : "Se connecter"}
          <ArrowRight size={17} />
        </button>

        {verifyingMfa ? (
          <button
            type="button"
            onClick={cancelMfa}
            disabled={isBusy}
            className="inline-flex min-h-10 items-center justify-center gap-2 text-sm font-bold text-[#59665f] hover:text-[#24332c]"
          >
            <ArrowLeft size={16} /> Revenir à la connexion
          </button>
        ) : null}
      </form>

      {!verifyingMfa ? (
        <p className="mt-7 text-center text-sm text-[#66736d]">
          Pas encore de compte ?{" "}
          <a
            href="/inscription"
            className="font-extrabold text-[#087a55] hover:underline"
          >
            Tester une facture
          </a>
        </p>
      ) : null}
    </AuthShell>
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function errorMessage(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  return typeof payload.message === "string" ? payload.message : fallback;
}
