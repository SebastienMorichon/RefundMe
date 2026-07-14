"use client";

import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, FileText, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../../components/auth-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const maxDocumentSizeBytes = 20 * 1024 * 1024;

export default function RegisterPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("Création de votre compte…");

  function selectFile(selectedFile: File | undefined) {
    setMessage("");
    if (!selectedFile) return;
    if (!allowedTypes.includes(selectedFile.type)) {
      setMessage("Choisissez un fichier PDF, JPG ou PNG.");
      return;
    }
    if (selectedFile.size > maxDocumentSizeBytes) {
      setMessage("Le fichier ne doit pas dépasser 20 Mo.");
      return;
    }
    setFile(selectedFile);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    selectFile(event.dataTransfer.files[0]);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== passwordConfirmation) {
      setMessage("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setStep(3);
    try {
      const registerResponse = await fetch(`${apiUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const registerPayload = await readJson(registerResponse);
      if (!registerResponse.ok) throw new Error(errorMessage(registerPayload, "Impossible de créer le compte."));

      if (file) {
        setProgress("Dépôt sécurisé de votre facture…");
        const uploadResponse = await fetch(`${apiUrl}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ kind: "ORANGE_INVOICE", originalName: file.name, mimeType: file.type, contentBase64: await fileToBase64(file) }),
        });
        const uploadPayload = await readJson(uploadResponse);
        const documentId = readDocumentId(uploadPayload.document);
        if (!uploadResponse.ok || !documentId) throw new Error(errorMessage(uploadPayload, "Le compte a été créé, mais la facture n’a pas pu être déposée."));

        setProgress("Analyse de la facture et des règlements…");
        await fetch(`${apiUrl}/documents/${documentId}/analyze`, { method: "POST", credentials: "include" });
      }

      setProgress("Votre espace est prêt.");
      router.push("/dashboard?bienvenue=1");
      router.refresh();
    } catch (error) {
      setStep(2);
      setMessage(error instanceof TypeError ? "Le service est momentanément indisponible. Vérifiez que l’API Lydoc est démarrée." : error instanceof Error ? error.message : "Inscription impossible.");
    }
  }

  return (
    <AuthShell>
      <div className="mb-8">
        <div className="flex items-center gap-2" aria-label={`Étape ${step} sur 3`}>
          {[1, 2, 3].map((item) => <span key={item} className={`h-1.5 flex-1 rounded-full ${item <= step ? "bg-[#2457f5]" : "bg-[#dce3ed]"}`} />)}
        </div>
        <div className="mt-3 flex justify-between text-[11px] font-extrabold uppercase text-[#7a8499]"><span>Facture</span><span>Compte</span><span>Analyse</span></div>
      </div>

      {step === 1 ? (
        <section>
          <p className="eyebrow">Étape 1 sur 3</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight text-[#102544] sm:text-4xl">Commençons par votre facture.</h1>
          <p className="mt-3 text-sm leading-6 text-[#667189]">Elle nous permettra de vous montrer rapidement le potentiel du service. Le fichier restera sur cet appareil jusqu’à la création du compte.</p>

          <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg" onChange={handleFileChange} className="sr-only" />
          {file ? (
            <div className="mt-7 flex items-center gap-4 rounded-md border border-[#b8c8f7] bg-[#f5f8ff] p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#e2eaff] text-[#2457f5]"><FileText size={21} /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-[#26334f]">{file.name}</p><p className="mt-1 text-xs text-[#667189]">{formatBytes(file.size)} · Prête à être analysée</p></div>
              <button type="button" onClick={() => setFile(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[#667189] hover:bg-[#e2eaff]" aria-label="Retirer le fichier"><Trash2 size={18} /></button>
            </div>
          ) : (
            <div onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }} role="button" tabIndex={0} className="mt-7 cursor-pointer rounded-md border-2 border-dashed border-[#aebdf0] bg-[#f8faff] px-5 py-10 text-center transition-colors hover:border-[#2457f5] hover:bg-[#f2f6ff]">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-[#e4ebff] text-[#2457f5]"><UploadCloud size={24} /></span>
              <p className="mt-5 text-sm font-extrabold text-[#26334f]">Glissez votre facture ici</p>
              <p className="mt-1 text-xs text-[#7a8499]">ou cliquez pour choisir un fichier</p>
              <p className="mt-4 text-[11px] font-semibold text-[#8b95a8]">PDF, JPG ou PNG · 20 Mo maximum</p>
            </div>
          )}
          {message ? <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#a34732]"><AlertCircle size={17} />{message}</p> : null}
          <button type="button" onClick={() => setStep(2)} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#1947d8]">{file ? "Continuer avec cette facture" : "Continuer sans facture"}<ArrowRight size={17} /></button>
          {!file ? <p className="mt-3 text-center text-xs text-[#7a8499]">Vous pourrez en déposer une plus tard depuis votre tableau de bord.</p> : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <button type="button" onClick={() => setStep(1)} className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#667189] hover:text-[#2457f5]"><ArrowLeft size={16} /> Modifier la facture</button>
          <p className="eyebrow">Étape 2 sur 3</p>
          <h1 className="mt-3 text-3xl font-extrabold text-[#102544] sm:text-4xl">Créez votre espace.</h1>
          <p className="mt-3 text-sm leading-6 text-[#667189]">Deux informations suffisent. Aucun RIB et aucune pièce d’identité ne sont nécessaires.</p>
          <form onSubmit={register} className="mt-7 grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-[#26334f]">Adresse e-mail<span className="relative"><Mail size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]" /><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required className="field pl-10" placeholder="vous@exemple.fr" /></span></label>
            <label className="grid gap-2 text-sm font-bold text-[#26334f]">Mot de passe<span className="relative"><LockKeyhole size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b95a8]" /><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="new-password" required className="field px-10" placeholder="8 caractères minimum" /><button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-[#667189] hover:bg-[#edf2f8]" aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
            <label className="grid gap-2 text-sm font-bold text-[#26334f]">Confirmer le mot de passe<input value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="new-password" required className="field" placeholder="Saisissez-le à nouveau" /></label>
            <div className="flex gap-3 border-l-4 border-[#16875b] bg-[#eef9f4] p-4 text-xs leading-5 text-[#326950]"><ShieldCheck size={18} className="mt-0.5 shrink-0" /><span><strong className="font-extrabold">Vos pièces sensibles attendront.</strong><br />Nous vous les demanderons seulement si le règlement du dossier les exige.</span></div>
            <label className="flex items-start gap-3 text-xs leading-5 text-[#667189]"><input type="checkbox" required className="mt-1 h-4 w-4 accent-[#2457f5]" /><span>J’accepte les <a href="/cgv" target="_blank" className="font-bold text-[#2457f5] underline">conditions générales</a> et la <a href="/confidentialite" target="_blank" className="font-bold text-[#2457f5] underline">politique de confidentialité</a>.</span></label>
            {message ? <div className="flex gap-3 border-l-4 border-[#e9654b] bg-[#fff0ec] p-4 text-sm leading-6 text-[#8e3d2c]" role="alert"><AlertCircle size={18} className="mt-0.5 shrink-0" />{message}</div> : null}
            <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#1947d8]">Créer mon compte et analyser <ArrowRight size={17} /></button>
          </form>
          <p className="mt-6 text-center text-sm text-[#667189]">Déjà inscrit ? <a href="/connexion" className="font-extrabold text-[#2457f5]">Se connecter</a></p>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="py-8 text-center" aria-live="polite">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-md bg-[#e8efff] text-[#2457f5]"><LoaderCircle size={30} className="animate-spin" /></span>
          <p className="eyebrow mt-8">Étape 3 sur 3</p>
          <h1 className="mt-3 text-3xl font-extrabold text-[#102544]">Nous préparons votre espace.</h1>
          <p className="mt-4 text-sm leading-6 text-[#667189]">{progress}</p>
          <div className="mt-7 grid gap-3 text-left text-sm text-[#536078]">
            {["Compte sécurisé", file ? "Facture déposée" : "Facture à ajouter plus tard", "Recherche des règlements applicables"].map((item, index) => <div key={item} className="flex items-center gap-3 border-b border-[#e2e8f0] pb-3"><span className={`grid h-6 w-6 place-items-center rounded-md ${index === 2 ? "bg-[#e8efff] text-[#2457f5]" : "bg-[#e8f7f0] text-[#16875b]"}`}>{index === 2 ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}</span>{item}</div>)}
          </div>
        </section>
      ) : null}
    </AuthShell>
  );
}

const allowedTypes = ["application/pdf", "image/png", "image/jpeg"];
async function fileToBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { if (typeof reader.result !== "string") return reject(new Error("Impossible de lire la facture.")); const separator = reader.result.indexOf(","); if (separator === -1) return reject(new Error("Impossible de préparer la facture.")); resolve(reader.result.slice(separator + 1)); }; reader.onerror = () => reject(new Error("Impossible de lire la facture.")); reader.readAsDataURL(file); }); }
async function readJson(response: Response): Promise<Record<string, unknown>> { try { const value: unknown = await response.json(); return value && typeof value === "object" ? value as Record<string, unknown> : {}; } catch { return {}; } }
function errorMessage(payload: Record<string, unknown>, fallback: string): string { return typeof payload.message === "string" ? payload.message : fallback; }
function readDocumentId(value: unknown): string | null { return value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string" ? (value as Record<string, unknown>).id as string : null; }
function formatBytes(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`; }
