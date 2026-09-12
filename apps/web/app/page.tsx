import Image from "next/image";
import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  FileSearch,
  LockKeyhole,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { PublicFooter } from "../components/public-footer";
import { PublicHeader } from "../components/public-header";

export const metadata: Metadata = {
  title: "Remboursement des SMS surtaxés de jeux-concours",
  description:
    "Lydoc prépare gratuitement votre dossier de remboursement de SMS surtaxés liés aux jeux-concours, à partir des informations que vous confirmez.",
};

const steps = [
  {
    number: "01",
    icon: Upload,
    title: "Déposez votre facture mobile",
    description:
      "Ajoutez la facture détaillée complète au format PDF, celle où apparaissent les SMS+ facturés pour vos jeux-concours.",
  },
  {
    number: "02",
    icon: FileSearch,
    title: "Recopiez vos frais SMS+",
    description:
      "Indiquez le nombre de SMS et leur montant total tels qu’ils apparaissent sur la facture.",
  },
  {
    number: "03",
    icon: Send,
    title: "Votre demande est préparée",
    description:
      "Vous ajoutez uniquement les justificatifs exigés, puis téléchargez gratuitement votre dossier conforme, prêt à envoyer.",
  },
];

const faqs = [
  [
    "Combien coûte Lydoc ?",
    "Pendant la phase de lancement, la constitution et le téléchargement du dossier sont entièrement gratuits. L’envoi postal pris en charge sera proposé ultérieurement.",
  ],
  [
    "Quels SMS surtaxés puis-je déclarer ?",
    "Vous pouvez déclarer les SMS+ facturés après une participation à un jeu-concours. Ils doivent apparaître sur votre facture mobile détaillée et le règlement du jeu doit prévoir une demande de remboursement.",
  ],
  [
    "Lydoc garantit-il le remboursement ?",
    "Non. Lydoc applique les conditions du règlement sélectionné, vous aide à constituer un dossier conforme et vous permet d’en suivre l’avancement. La décision finale appartient à l’organisateur.",
  ],
];

export default function HomePage() {
  return (
    <div className="bg-white text-[#17211d]">
      <PublicHeader />
      <main>
        <section className="lydoc-hero relative isolate overflow-hidden border-b border-[#dce5e0] bg-[#fbfaf5]">
          <div className="lydoc-orb lydoc-orb-coral" aria-hidden="true" />
          <div className="lydoc-orb lydoc-orb-mint" aria-hidden="true" />
          <div className="page-container grid min-h-[650px] items-center gap-8 py-14 lg:grid-cols-[0.82fr_1.18fr] lg:py-10">
            <div className="rise-in relative z-10 max-w-[600px]">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#b9dbc9] bg-white px-4 py-2 text-xs font-extrabold text-[#087a55] shadow-sm">
                <Sparkles size={15} aria-hidden="true" /> Jeux-concours :
                remboursement des SMS+
              </div>
              <h1 className="max-w-[610px] text-4xl font-extrabold leading-[1.06] text-[#17211d] sm:text-5xl lg:text-[58px]">
                Préparez votre dossier de remboursement de{" "}
                <span className="relative text-[#087a55]">
                  SMS surtaxés
                  <span
                    className="absolute -bottom-1 left-0 h-2 w-full rounded-full bg-[#f4b942]/55"
                    aria-hidden="true"
                  />
                </span>
                .
              </h1>
              <p className="mt-6 max-w-[560px] text-base leading-7 text-[#4f5d78] sm:text-lg sm:leading-8">
                Vous avez participé à un jeu-concours par SMS+ ? Indiquez les
                frais figurant sur votre facture mobile : Lydoc applique le bon
                règlement et constitue gratuitement votre dossier prêt à
                envoyer.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="/inscription"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#087a55] px-6 py-3 text-sm font-extrabold text-white shadow-[0_8px_0_#065d42] transition-transform hover:-translate-y-0.5 hover:bg-[#066344]"
                >
                  Préparer mon remboursement <ArrowRight size={17} />
                </a>
                <a
                  href="#fonctionnement"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#bdc9d8] bg-white px-5 py-3 text-sm font-extrabold text-[#17211d] hover:border-[#087a55]"
                >
                  Comprendre les 3 étapes
                </a>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-[#4f5d78]">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-[#16875b]" /> Sans
                  abonnement
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck size={16} className="text-[#16875b]" /> Documents
                  chiffrés
                </span>
                <span className="inline-flex items-center gap-2">
                  <ReceiptText size={16} className="text-[#16875b]" /> Dossier
                  PDF gratuit
                </span>
              </div>
            </div>
            <div className="rise-in relative min-h-[360px] lg:min-h-[570px]">
              <Image
                src="/illustrations/lydi-hero.png"
                alt="Lydi transforme une facture mobile en dossier de remboursement de SMS surtaxés"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 58vw"
                className="object-contain"
              />
            </div>
          </div>
        </section>

        <section
          className="border-b border-[#e2e8f0] bg-white"
          aria-label="Engagements Lydoc"
        >
          <div className="page-container grid grid-cols-2 divide-x divide-[#e2e8f0] py-5 md:grid-cols-4">
            {[
              ["1 PDF", "votre facture mobile détaillée"],
              ["SMS+", "de jeux-concours détectés"],
              ["0 €", "pour l’analyse et le dossier"],
              ["À la demande", "aucun abonnement"],
            ].map(([value, label]) => (
              <div key={label} className="px-3 py-2 text-center sm:px-6">
                <p className="text-lg font-extrabold text-[#17211d]">{value}</p>
                <p className="mt-1 text-xs text-[#6b768c] sm:text-sm">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="fonctionnement"
          className="scroll-mt-20 overflow-hidden bg-[#fbfaf5] py-20 sm:py-24"
        >
          <div className="page-container">
            <div className="max-w-2xl">
              <p className="eyebrow">En 3 étapes</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#17211d] sm:text-4xl">
                De vos SMS surtaxés au dossier conforme, sans vous perdre dans
                les règles.
              </h2>
              <p className="mt-4 text-base leading-7 text-[#5d6881]">
                Vous commencez avec votre facture mobile. Les autres
                justificatifs ne sont demandés que si le règlement du
                jeu-concours les exige.
              </p>
            </div>
            <div className="relative mt-8 aspect-[1.9/1] w-full sm:aspect-[2.5/1] lg:aspect-[3.1/1]">
              <Image
                src="/illustrations/lydi-steps.png"
                alt="Lydi analyse les SMS surtaxés et prépare une demande de remboursement"
                fill
                sizes="100vw"
                className="object-contain"
              />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <article
                    key={step.number}
                    className="relative overflow-hidden rounded-[22px] border border-[#dce5e0] bg-white p-6 shadow-[0_12px_30px_rgba(23,33,29,0.06)] lg:p-8"
                  >
                    <div className="flex items-center justify-between">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e4f3eb] text-[#087a55]">
                        <Icon size={21} />
                      </span>
                      <span className="text-4xl font-black text-[#f1b732]/70">
                        {step.number}
                      </span>
                    </div>
                    <h3 className="mt-7 text-xl font-extrabold text-[#17211d]">
                      {step.title}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-[#5d6881]">
                      {step.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-y border-[#dce5e0] bg-[#f3f6fa] py-20 sm:py-24">
          <div className="page-container grid items-center gap-12 lg:grid-cols-[0.78fr_1.22fr]">
            <div>
              <p className="eyebrow">Vos demandes au même endroit</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#17211d] sm:text-4xl">
                Suivez chaque dossier, du SMS détecté à la réponse.
              </h2>
              <p className="mt-5 text-base leading-7 text-[#5d6881]">
                Montant estimatif récupérable, justificatifs manquants,
                progression de la demande : vous savez exactement quoi faire
                pour chaque jeu-concours.
              </p>
              <ul className="mt-7 grid gap-4 text-sm font-semibold text-[#526058]">
                {[
                  "Montant estimatif récupérable pour chaque jeu",
                  "Pièces exactes demandées par le règlement",
                  "Historique clair de vos SMS+ et de vos dossiers",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-[#e8f7f0] text-[#16875b]">
                      <Check size={15} strokeWidth={3} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="/inscription"
                className="mt-8 inline-flex items-center gap-2 text-sm font-extrabold text-[#087a55] hover:text-[#066344]"
              >
                Créer mon premier dossier <ChevronRight size={17} />
              </a>
            </div>

            <div
              className="surface overflow-hidden bg-white shadow-[0_24px_60px_rgba(16,37,68,0.13)]"
              aria-label="Aperçu du tableau de bord Lydoc"
            >
              <div className="flex h-12 items-center justify-between border-b border-[#dce5e0] px-4">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#e9654b]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#e7b84b]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#40b883]" />
                </div>
                <span className="text-[11px] font-bold text-[#8b95a8]">
                  app.lydoc.fr
                </span>
              </div>
              <div className="grid min-h-[390px] sm:grid-cols-[150px_1fr]">
                <div className="hidden bg-[#17211d] p-4 sm:block">
                  <p className="text-xs font-extrabold text-white">Lydoc</p>
                  <div className="mt-7 grid gap-2 text-[10px] font-semibold text-[#b8c5d8]">
                    <span className="rounded bg-white/10 px-2 py-2 text-white">
                      Vue d’ensemble
                    </span>
                    <span className="px-2 py-2">Mes factures</span>
                    <span className="px-2 py-2">Mes dossiers</span>
                    <span className="px-2 py-2">Remboursements</span>
                  </div>
                </div>
                <div className="p-5 sm:p-6">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs text-[#7b8781]">Bonjour Jean</p>
                      <p className="mt-1 text-lg font-extrabold text-[#17211d]">
                        Votre espace
                      </p>
                    </div>
                    <span className="rounded-md bg-[#087a55] px-3 py-2 text-[10px] font-extrabold text-white">
                      + Déposer
                    </span>
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                      ["14,85 €", "Estimé récupérable"],
                      ["2", "Dossiers"],
                      ["1", "Envoyé"],
                      ["32,40 €", "Remboursé"],
                    ].map(([value, label], index) => (
                      <div
                        key={label}
                        className="rounded-md border border-[#dce5e0] p-3"
                      >
                        <p
                          className={`text-base font-extrabold ${index === 3 ? "text-[#16875b]" : "text-[#17211d]"}`}
                        >
                          {value}
                        </p>
                        <p className="mt-1 text-[10px] text-[#7b8781]">
                          {label}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-7 text-xs font-extrabold text-[#17211d]">
                    Activité récente
                  </p>
                  <div className="mt-3 divide-y divide-[#e6ebf1] border-y border-[#e6ebf1]">
                    {[
                      [
                        "Facture mobile analysée",
                        "4 SMS+ détectés",
                        "Aujourd’hui",
                      ],
                      ["Dossier jeu M6 prêt", "Pièces complètes", "Hier"],
                      ["Remboursement reçu", "24,90 €", "28 juin"],
                    ].map(([title, info, date]) => (
                      <div
                        key={title}
                        className="grid grid-cols-[1fr_auto] gap-3 py-3 text-[10px]"
                      >
                        <div>
                          <p className="font-bold text-[#526058]">{title}</p>
                          <p className="mt-1 text-[#7b8781]">{info}</p>
                        </div>
                        <span className="text-[#9aa3b3]">{date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#17211d] py-20 text-white sm:py-24">
          <div className="page-container grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="eyebrow !text-[#82a3ff]">Vos factures protégées</p>
              <h2 className="mt-3 max-w-xl text-3xl font-extrabold leading-tight sm:text-4xl">
                Vos justificatifs de remboursement traités avec le sérieux
                qu’ils méritent.
              </h2>
              <p className="mt-5 max-w-xl text-base leading-7 text-[#c2cede]">
                Votre facture mobile et vos documents sont chiffrés. Leur accès
                est limité à l’analyse des SMS+ et à la préparation de votre
                dossier.
              </p>
              <a
                href="/securite"
                className="mt-8 inline-flex items-center gap-2 text-sm font-extrabold text-white hover:text-[#b8caff]"
              >
                Découvrir notre approche sécurité <ArrowRight size={17} />
              </a>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg border border-white/[0.15] bg-white/[0.15] sm:grid-cols-2">
              {[
                [
                  LockKeyhole,
                  "Chiffrement",
                  "Vos fichiers sont chiffrés pendant leur stockage.",
                ],
                [
                  ShieldCheck,
                  "Accès contrôlé",
                  "Seules les opérations utiles au dossier sont autorisées.",
                ],
                [
                  FileCheck2,
                  "Traçabilité",
                  "Chaque facture reste associée au bon jeu-concours.",
                ],
                [
                  ReceiptText,
                  "Collecte minimale",
                  "RIB et identité uniquement si le règlement du jeu l’exige.",
                ],
              ].map(([Icon, title, description]) => {
                const SecurityIcon = Icon as typeof LockKeyhole;
                return (
                  <div key={title as string} className="bg-[#17211d] p-6">
                    <SecurityIcon size={22} className="text-[#82a3ff]" />
                    <h3 className="mt-5 font-extrabold">{title as string}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#b8c5d8]">
                      {description as string}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="tarifs" className="scroll-mt-20 bg-white py-20 sm:py-24">
          <div className="page-container grid gap-12 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div className="max-w-xl">
              <p className="eyebrow">Gratuit pendant le lancement</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#17211d] sm:text-4xl">
                Déclarez vos SMS+ et téléchargez votre dossier conforme.
              </h2>
              <p className="mt-5 text-base leading-7 text-[#5d6881]">
                La création du compte et le dossier de remboursement complet
                sont gratuits. Vous n’avez rien à payer pour préparer votre
                demande concernant vos SMS surtaxés.
              </p>
            </div>
            <div className="grid gap-3">
              <div className="border-l-4 border-[#087a55] bg-[#f3f6fa] px-6 py-7 sm:px-8">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-[#5d6881]">
                      Dossier de remboursement à télécharger
                    </p>
                    <p className="mt-1 text-4xl font-extrabold text-[#17211d]">
                      0 €
                    </p>
                  </div>
                  <span className="rounded-md bg-[#e8f7f0] px-3 py-2 text-xs font-extrabold text-[#16875b]">
                    Disponible maintenant
                  </span>
                </div>
                <div className="mt-6 border-t border-[#d5dde8] pt-6">
                  <p className="text-sm leading-6 text-[#5d6881]">
                    Le PDF contient votre lettre de demande et les justificatifs
                    exigés par le règlement du jeu. Vous l’imprimez et l’envoyez
                    vous-même.
                  </p>
                  <a
                    href="/inscription"
                    className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-[#087a55]"
                  >
                    Préparer mon dossier <ArrowRight size={17} />
                  </a>
                </div>
              </div>
              <div className="border border-dashed border-[#b9c8c1] bg-white px-6 py-5 sm:px-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-extrabold text-[#17211d]">
                      Impression et envoi du dossier par Lydoc
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#66736d]">
                      Validation finale, impression, mise sous pli,
                      affranchissement et suivi postal.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-[#eef2f0] px-3 py-2 text-[10px] font-extrabold uppercase text-[#66736d]">
                    Bientôt disponible
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[#dce5e0] bg-[#f3f6fa] py-20 sm:py-24">
          <div className="page-container grid gap-12 lg:grid-cols-[0.65fr_1fr]">
            <div>
              <p className="eyebrow">Remboursement des SMS+</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#17211d]">
                Les réponses utiles avant de préparer votre dossier.
              </h2>
              <a
                href="/faq"
                className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-[#087a55]"
              >
                Voir toute la FAQ <ArrowRight size={17} />
              </a>
            </div>
            <div className="divide-y divide-[#cfd8e4] border-y border-[#cfd8e4]">
              {faqs.map(([question, answer]) => (
                <details key={question} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-extrabold text-[#17211d]">
                    {question}
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-[#087a55] transition-transform group-open:rotate-90">
                      <ChevronRight size={17} />
                    </span>
                  </summary>
                  <p className="max-w-2xl pb-5 pr-10 text-sm leading-6 text-[#5d6881]">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white py-20 sm:py-24">
          <div className="page-container flex flex-col items-start justify-between gap-8 border-y border-[#dce5e0] py-12 md:flex-row md:items-center">
            <div className="max-w-2xl">
              <p className="eyebrow">
                Votre facture mobile est le point de départ
              </p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#17211d]">
                Repérez vos SMS surtaxés et préparez votre demande.
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#5d6881]">
                Créez votre compte, déposez votre facture PDF et découvrez si le
                règlement du jeu permet de demander un remboursement. Aucun RIB
                ni pièce d’identité ne sont nécessaires pour commencer.
              </p>
            </div>
            <a
              href="/inscription"
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#066344]"
            >
              Préparer mon remboursement <ArrowRight size={17} />
            </a>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
