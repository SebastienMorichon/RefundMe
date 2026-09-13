import type { Metadata } from "next";
import { ArrowRight, BookOpen, Clock3 } from "lucide-react";
import { PublicPage } from "../../components/public-page";
import { guides } from "../../lib/guides";

export const metadata: Metadata = {
  title: "Guides sur le remboursement des SMS surtaxés",
  description:
    "Guides pratiques pour retrouver vos SMS+, vérifier un règlement et préparer une demande de remboursement de jeu-concours.",
  alternates: { canonical: "/guides" },
};

export default function GuidesPage() {
  return (
    <PublicPage
      eyebrow="Guides pratiques"
      title="Comprendre votre facture et préparer une demande complète."
      description="Des explications prudentes et concrètes pour avancer étape par étape. Le règlement propre à chaque jeu reste toujours la référence."
    >
      <section className="page-container py-14 sm:py-20">
        <div className="grid gap-5 lg:grid-cols-2">
          {guides.map((guide) => (
            <article
              key={guide.slug}
              className="flex flex-col rounded-[22px] border border-[#dce5e0] bg-white p-6 shadow-[0_12px_30px_rgba(23,33,29,0.06)] sm:p-8"
            >
              <div className="flex items-center justify-between gap-4 text-xs font-extrabold text-[#087a55]">
                <span className="inline-flex items-center gap-2">
                  <BookOpen size={16} /> {guide.eyebrow}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[#7b8781]">
                  <Clock3 size={14} /> {guide.readingTime}
                </span>
              </div>
              <h2 className="mt-5 text-2xl font-extrabold leading-tight text-[#17211d]">
                {guide.title}
              </h2>
              <p className="mt-4 flex-1 text-sm leading-7 text-[#5d6881]">
                {guide.description}
              </p>
              <a
                href={`/guides/${guide.slug}`}
                className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-[#087a55]"
              >
                Lire le guide <ArrowRight size={17} />
              </a>
            </article>
          ))}
        </div>
      </section>
    </PublicPage>
  );
}
