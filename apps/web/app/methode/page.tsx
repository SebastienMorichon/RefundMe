import type { Metadata } from "next";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileCheck2,
  SearchCheck,
  UserCheck,
} from "lucide-react";
import { PublicPage } from "../../components/public-page";

export const metadata: Metadata = {
  title: "Notre méthode de préparation des dossiers",
  description:
    "Découvrez comment Lydoc référence un règlement, demande votre confirmation et prépare un dossier de remboursement à relire avant envoi.",
  alternates: { canonical: "/methode" },
};

const steps = [
  {
    icon: SearchCheck,
    title: "Le règlement est identifié",
    description:
      "Chaque fiche part d’un règlement de jeu importé dans Lydoc. Sa période, ses conditions, son adresse et ses justificatifs sont structurés.",
  },
  {
    icon: UserCheck,
    title: "Un administrateur vérifie la fiche",
    description:
      "Une extraction automatique ne suffit pas : le règlement doit être relu et approuvé avant de pouvoir servir à un dossier utilisateur.",
  },
  {
    icon: FileCheck2,
    title: "Vous confirmez vos informations",
    description:
      "Vous choisissez le jeu et confirmez le nombre de SMS ainsi que le montant figurant sur votre facture. Les pièces supplémentaires ne sont demandées que si la fiche les prévoit.",
  },
  {
    icon: CheckCircle2,
    title: "Vous relisez le dossier",
    description:
      "Lydoc assemble la lettre et les justificatifs. Vous téléchargez, contrôlez, imprimez et envoyez vous-même le dossier dans la version gratuite actuelle.",
  },
] as const;

export default function MethodPage() {
  return (
    <PublicPage
      eyebrow="Transparence"
      title="Une méthode vérifiable, du règlement au dossier."
      description="Lydoc simplifie la préparation administrative sans décider à la place de l’organisateur et sans transformer une estimation en promesse."
    >
      <section className="page-container py-14 sm:py-20">
        <div className="grid gap-px overflow-hidden rounded-[22px] border border-[#dce5e0] bg-[#dce5e0] lg:grid-cols-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="bg-white p-7 sm:p-9">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e8f7f0] text-[#087a55]">
                    <Icon size={21} />
                  </span>
                  <span className="text-3xl font-black text-[#f1b732]/70">
                    0{index + 1}
                  </span>
                </div>
                <h2 className="mt-6 text-xl font-extrabold text-[#17211d]">
                  {step.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[#5d6881]">
                  {step.description}
                </p>
              </article>
            );
          })}
        </div>

        <div className="mt-14 grid items-center gap-8 rounded-[22px] bg-[#17211d] p-7 text-white sm:p-10 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-extrabold uppercase text-[#82a3ff]">
              Démonstration sans données personnelles
            </p>
            <h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">
              Consultez un exemple entièrement fictif.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[#c2cede]">
              Le PDF montre une lettre, une checklist et un extrait de facture
              inventé. Il illustre la structure du résultat sans représenter un
              dossier réel ni garantir son acceptation.
            </p>
          </div>
          <a
            href="/exemples/exemple-dossier-lydoc.pdf"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-extrabold text-[#17211d]"
          >
            <Download size={18} /> Voir l’exemple PDF
          </a>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-6 border-y border-[#dce5e0] py-10 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-extrabold text-[#17211d]">
              Vous avez une facture concernée ?
            </h2>
            <p className="mt-2 text-sm text-[#5d6881]">
              Commencez gratuitement et vérifiez le règlement disponible.
            </p>
          </div>
          <a
            href="/inscription"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 text-sm font-extrabold text-white"
          >
            Préparer mon dossier <ArrowRight size={17} />
          </a>
        </div>
      </section>
    </PublicPage>
  );
}
