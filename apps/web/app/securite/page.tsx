import type { Metadata } from "next";
import { Database, EyeOff, FileLock2, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Sécurité" };

const safeguards = [
  [FileLock2, "Chiffrement des documents", "Chaque fichier déposé est chiffré avant son stockage afin de limiter son exposition."],
  [KeyRound, "Sessions protégées", "Votre session repose sur un cookie sécurisé non accessible au code de la page."],
  [EyeOff, "Collecte minimale", "Nous demandons le RIB ou l’identité uniquement lorsqu’une règle de remboursement les rend nécessaires."],
  [Database, "Données séparées", "Les documents sont reliés à leur propriétaire et à leur dossier pour éviter les mélanges d’accès."],
  [ShieldCheck, "Règlements relus", "Les résultats automatiques s’appuient sur des règlements analysés puis validés dans l’espace administrateur."],
  [Trash2, "Maîtrise des données", "La suppression et la durée de conservation seront pilotables depuis le compte dans la version de production."],
];

export default function SecurityPage() {
  return (
    <PublicPage eyebrow="Sécurité et confidentialité" title="La confiance ne doit pas être une option cachée." description="Lydoc est conçu autour d’un principe simple : utiliser le minimum de données nécessaire pour préparer votre dossier.">
      <section className="page-container py-16 sm:py-20">
        <div className="grid border-y border-[#dce3ed] md:grid-cols-2 lg:grid-cols-3">
          {safeguards.map(([Icon, title, description], index) => {
            const ItemIcon = Icon as typeof ShieldCheck;
            return <article key={title as string} className={`px-1 py-8 md:px-7 ${index < safeguards.length - 1 ? "border-b border-[#dce3ed]" : ""} md:border-b lg:[&:nth-child(-n+3)]:border-b ${index % 2 === 0 ? "md:border-r" : ""} lg:border-r lg:[&:nth-child(3n)]:border-r-0`}><ItemIcon size={23} className="text-[#2457f5]" /><h2 className="mt-5 text-lg font-extrabold text-[#102544]">{title as string}</h2><p className="mt-3 text-sm leading-6 text-[#5d6881]">{description as string}</p></article>;
          })}
        </div>
        <div className="mt-16 grid gap-10 bg-[#102544] px-6 py-10 text-white sm:px-10 lg:grid-cols-[1fr_0.8fr] lg:items-center">
          <div><p className="text-xs font-extrabold uppercase text-[#82a3ff]">Transparence</p><h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">Un doute sur l’usage d’une donnée ? Parlons-en.</h2><p className="mt-4 max-w-xl text-sm leading-7 text-[#bdc9dc]">La page de confidentialité détaille les catégories de données utilisées. Vous pouvez également nous écrire pour toute question ou demande liée à votre compte.</p></div>
          <div className="flex flex-col gap-3 sm:flex-row lg:justify-end"><a href="/confidentialite" className="inline-flex min-h-11 items-center justify-center rounded-md border border-white/30 px-4 text-sm font-extrabold hover:bg-white/10">Lire la confidentialité</a><a href="/contact" className="inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 text-sm font-extrabold text-[#102544]">Contacter Lydoc</a></div>
        </div>
      </section>
    </PublicPage>
  );
}
