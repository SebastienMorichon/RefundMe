"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { AuthShell } from "../../components/auth-shell";
import { apiFetch as fetch } from "../../lib/api-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const currentLegalConsentVersion = "2026-08-03.v1";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [legalConsentAccepted, setLegalConsentAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!legalConsentAccepted) {
      setMessage(
        "Vous devez accepter les conditions et la politique applicables.",
      );
      return;
    }
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          consentAccepted: true,
          consentVersion: currentLegalConsentVersion,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, "Impossible de démarrer l’inscription."),
        );
      }
      setIsRegistered(true);
    } catch (error) {
      setMessage(
        error instanceof TypeError
          ? "Le service est momentanément indisponible."
          : error instanceof Error
            ? error.message
            : "Inscription impossible.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function resendVerification() {
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(
          errorMessage(payload, "Impossible de renvoyer le message."),
        );
      }
      setMessage(
        "Si cette adresse peut être utilisée, un nouveau lien vient d’être envoyé.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Envoi momentanément impossible.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AuthShell>
      {isRegistered ? (
        <section className="py-4 text-center" aria-live="polite">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-md bg-[#e4f3eb] text-[#087a55]">
            <CheckCircle2 size={31} />
          </span>
          <p className="eyebrow mt-8">Vérification requise</p>
          <h1 className="mt-3 text-3xl font-extrabold text-[#17211d]">
            Consultez votre boîte e-mail.
          </h1>
          <p className="mt-4 text-sm leading-6 text-[#66736d]">
            Si l’adresse <strong>{email}</strong> peut être utilisée, nous y
            avons envoyé un lien valable 24 heures. Vous choisirez votre mot de
            passe uniquement depuis ce lien sécurisé.
          </p>
          <div className="mt-7 border-l-4 border-[#16875b] bg-[#eef9f4] p-4 text-left text-xs leading-5 text-[#326950]">
            Votre compte ne peut pas être utilisé avant la vérification. Votre
            facture sera déposée depuis votre espace après activation, afin
            qu’aucun document ne soit conservé avant que votre adresse soit
            confirmée.
          </div>
          {message ? (
            <p className="mt-5 text-sm font-semibold text-[#526058]" role="status">
              {message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void resendVerification()}
            disabled={isBusy}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[#9dc4b1] px-5 text-sm font-extrabold text-[#087a55] hover:bg-[#eef7f2] disabled:cursor-wait disabled:opacity-60"
          >
            {isBusy ? (
              <LoaderCircle size={17} className="animate-spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            Renvoyer le lien
          </button>
          <a
            href="/connexion"
            className="mt-4 inline-block text-sm font-bold text-[#087a55] hover:underline"
          >
            Revenir à la connexion
          </a>
        </section>
      ) : (
        <section>
          <p className="eyebrow">Créer un compte</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight text-[#17211d] sm:text-4xl">
            Commencez par vérifier votre e-mail.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#66736d]">
            Nous vous enverrons un lien à usage unique. Vous choisirez ensuite
            votre mot de passe et pourrez déposer votre première facture PDF.
          </p>

          <form onSubmit={register} className="mt-8 grid gap-5">
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
                  maxLength={254}
                  required
                  className="field field-with-leading-icon"
                  placeholder="vous@exemple.fr"
                />
              </span>
            </label>

            <div className="flex gap-3 border-l-4 border-[#16875b] bg-[#eef9f4] p-4 text-xs leading-5 text-[#326950]">
              <ShieldCheck size={18} className="mt-0.5 shrink-0" />
              <span>
                Aucun mot de passe, document ou compte actif n’est créé tant
                que vous n’avez pas ouvert le lien reçu par e-mail.
              </span>
            </div>

            <label className="flex items-start gap-3 text-xs leading-5 text-[#66736d]">
              <input
                type="checkbox"
                required
                checked={legalConsentAccepted}
                onChange={(event) =>
                  setLegalConsentAccepted(event.target.checked)
                }
                className="mt-1 h-4 w-4 accent-[#087a55]"
              />
              <span>
                J’accepte les{" "}
                <a
                  href="/cgu"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-[#087a55] underline"
                >
                  conditions d’utilisation
                </a>{" "}
                et j’ai pris connaissance de la{" "}
                <a
                  href="/confidentialite"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-[#087a55] underline"
                >
                  politique de confidentialité
                </a>
                .
              </span>
            </label>

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
              disabled={isBusy}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#066344] disabled:cursor-wait disabled:opacity-60"
            >
              {isBusy ? (
                <LoaderCircle size={17} className="animate-spin" />
              ) : (
                <ArrowRight size={17} />
              )}
              Recevoir mon lien sécurisé
            </button>
          </form>

          <p className="mt-7 text-center text-sm text-[#66736d]">
            Déjà inscrit ?{" "}
            <a
              href="/connexion"
              className="font-extrabold text-[#087a55] hover:underline"
            >
              Se connecter
            </a>
          </p>
        </section>
      )}
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
