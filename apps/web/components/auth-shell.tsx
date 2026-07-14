import Image from "next/image";
import type { ReactNode } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { Brand } from "./brand";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[0.92fr_1.08fr]">
      <section className="relative hidden min-h-screen overflow-hidden border-r border-[#dce3ed] bg-[#f3f6fa] lg:block">
        <Image src="/images/lydoc-hero-invoice.png" alt="Facture analysée dans Lydoc" fill priority sizes="42vw" className="object-cover object-[62%_center]" />
        <div className="absolute inset-x-0 bottom-0 bg-[#102544] px-10 py-9 text-white">
          <p className="max-w-md text-2xl font-extrabold leading-tight">Votre facture d’abord. Vos documents sensibles seulement si le dossier les exige.</p>
          <div className="mt-6 grid gap-3 text-sm text-[#d0daea]">
            <span className="flex items-center gap-2"><CheckCircle2 size={17} className="text-[#65d2a5]" /> Analyse initiale sans paiement</span>
            <span className="flex items-center gap-2"><LockKeyhole size={17} className="text-[#65d2a5]" /> Fichiers chiffrés et accès contrôlé</span>
          </div>
        </div>
      </section>
      <section className="flex min-h-screen flex-col">
        <header className="flex h-[72px] items-center justify-between border-b border-[#e2e8f0] px-5 sm:px-8">
          <a href="/" aria-label="Accueil Lydoc"><Brand /></a>
          <a href="/" className="text-sm font-bold text-[#536078] hover:text-[#2457f5]">Retour à l’accueil</a>
        </header>
        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[490px]">{children}</div>
        </div>
      </section>
    </main>
  );
}
