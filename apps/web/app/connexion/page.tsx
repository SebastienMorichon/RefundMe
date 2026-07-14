"use client";

import { AlertCircle, ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../../components/auth-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, "Adresse e-mail ou mot de passe incorrect."));
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof TypeError ? "Le service est momentanément indisponible. Vérifiez que l’API Lydoc est démarrée." : error instanceof Error ? error.message : "Connexion impossible.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AuthShell>
      <p className="eyebrow">Heureux de vous revoir</p>
      <h1 className="mt-3 text-3xl font-extrabold text-[#102544] sm:text-4xl">Connectez-vous à Lydoc.</h1>
      <p className="mt-3 text-sm leading-6 text-[#667189]">Retrouvez vos analyses, vos documents et l’avancement de vos dossiers.</p>

      <form onSubmit={login} className="mt-8 grid gap-5">
        <label className="grid gap-2 text-sm font-bold text-[#26334f]">
          Adresse e-mail
          <span className="relative"><Mail size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]" /><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required className="field pl-10" placeholder="vous@exemple.fr" /></span>
        </label>
        <label className="grid gap-2 text-sm font-bold text-[#26334f]">
          <span className="flex items-center justify-between"><span>Mot de passe</span><a href="/contact" className="text-xs font-bold text-[#2457f5] hover:underline">Mot de passe oublié ?</a></span>
          <span className="relative"><LockKeyhole size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]" /><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" required className="field px-10" placeholder="Votre mot de passe" /><button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-[#667189] hover:bg-[#edf2f8]" aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        {message ? <div className="flex gap-3 border-l-4 border-[#e9654b] bg-[#fff0ec] p-4 text-sm leading-6 text-[#8e3d2c]" role="alert"><AlertCircle size={18} className="mt-0.5 shrink-0" />{message}</div> : null}
        <button disabled={isBusy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#1947d8] disabled:cursor-wait disabled:opacity-60">{isBusy ? "Connexion…" : "Se connecter"}<ArrowRight size={17} /></button>
      </form>
      <p className="mt-7 text-center text-sm text-[#667189]">Pas encore de compte ? <a href="/inscription" className="font-extrabold text-[#2457f5] hover:underline">Tester une facture</a></p>
    </AuthShell>
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> { try { const value: unknown = await response.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return {}; } }
function errorMessage(payload: Record<string, unknown>, fallback: string): string { return typeof payload.message === "string" ? payload.message : fallback; }
