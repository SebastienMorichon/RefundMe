import Image from "next/image";
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

const steps = [
  {
    number: "01",
    icon: Upload,
    title: "Déposez votre facture",
    description: "Une photo ou un PDF suffit. Aucune pièce d’identité ni aucun RIB ne sont demandés à l’inscription.",
  },
  {
    number: "02",
    icon: FileSearch,
    title: "Lydoc vérifie le règlement",
    description: "La facture est lue et comparée aux conditions du jeu validées par notre équipe.",
  },
  {
    number: "03",
    icon: Send,
    title: "Votre dossier est préparé",
    description: "Vous complétez uniquement les pièces réellement exigées, puis suivez chaque étape depuis votre espace.",
  },
];

const faqs = [
  ["Combien coûte Lydoc ?", "L’analyse initiale de votre facture est gratuite. Le tarif du service est affiché avant toute validation du dossier, sans abonnement."],
  ["Dois-je envoyer mon RIB à l’inscription ?", "Non. Le RIB et la pièce d’identité ne sont jamais demandés pour créer votre compte. Ils ne le sont que si le règlement applicable les exige pour constituer votre dossier."],
  ["Lydoc garantit-il le remboursement ?", "Non. Lydoc analyse les conditions, vous aide à constituer un dossier conforme et vous permet d’en suivre l’avancement. La décision finale appartient à l’organisateur."],
];

export default function HomePage() {
  return (
    <div className="bg-white text-[#111b35]">
      <PublicHeader />
      <main>
        <section className="relative isolate overflow-hidden border-b border-[#dce3ed] bg-[#f7f9fc]">
          <Image
            src="/images/lydoc-hero-invoice.png"
            alt="Facture analysée par Lydoc avec estimation du remboursement"
            fill
            priority
            sizes="100vw"
            className="-z-10 object-cover object-[64%_center] opacity-30 sm:object-center sm:opacity-100"
          />
          <div className="page-container flex min-h-[620px] items-center py-16 sm:min-h-[650px] lg:min-h-[calc(100svh-150px)] lg:max-h-[760px]">
            <div className="rise-in max-w-[620px]">
              <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-[#cbd7f7] bg-white/90 px-3 py-2 text-xs font-extrabold text-[#2457f5] shadow-sm">
                <Sparkles size={15} aria-hidden="true" /> Analyse gratuite de votre première facture
              </div>
              <h1 className="max-w-[610px] text-4xl font-extrabold leading-[1.08] text-[#102544] sm:text-5xl lg:text-6xl">
                Détectez les remboursements cachés dans vos factures.
              </h1>
              <p className="mt-6 max-w-[560px] text-base leading-7 text-[#4f5d78] sm:text-lg sm:leading-8">
                Lydoc lit votre facture, vérifie les règlements applicables et vous indique combien vous pourriez récupérer. Vous décidez ensuite si vous souhaitez préparer le dossier.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href="/inscription" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 py-3 text-sm font-extrabold text-white shadow-md hover:bg-[#1947d8]">
                  Analyser ma facture <ArrowRight size={17} />
                </a>
                <a href="#fonctionnement" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[#bdc9d8] bg-white/90 px-5 py-3 text-sm font-extrabold text-[#102544] hover:bg-white">
                  Voir comment ça marche
                </a>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-[#4f5d78]">
                <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-[#16875b]" /> Sans abonnement</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck size={16} className="text-[#16875b]" /> Documents chiffrés</span>
                <span className="inline-flex items-center gap-2"><ReceiptText size={16} className="text-[#16875b]" /> Aucun paiement à l’analyse</span>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-[#e2e8f0] bg-white" aria-label="Engagements Lydoc">
          <div className="page-container grid grid-cols-2 divide-x divide-[#e2e8f0] py-5 md:grid-cols-4">
            {[
              ["20 Mo", "PDF, JPG ou PNG"],
              ["2 minutes", "pour connaître le potentiel"],
              ["0 €", "pour analyser la facture"],
              ["À la demande", "aucun abonnement"],
            ].map(([value, label]) => (
              <div key={label} className="px-3 py-2 text-center sm:px-6">
                <p className="text-lg font-extrabold text-[#102544]">{value}</p>
                <p className="mt-1 text-xs text-[#6b768c] sm:text-sm">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="fonctionnement" className="scroll-mt-20 bg-white py-20 sm:py-24">
          <div className="page-container">
            <div className="max-w-2xl">
              <p className="eyebrow">Simple par conception</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#102544] sm:text-4xl">De la facture au dossier, sans vous perdre dans les règles.</h2>
              <p className="mt-4 text-base leading-7 text-[#5d6881]">Vous voyez la valeur du service avant de fournir les documents sensibles nécessaires à la demande.</p>
            </div>
            <div className="mt-14 grid border-y border-[#dce3ed] md:grid-cols-3 md:divide-x md:divide-[#dce3ed]">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <article key={step.number} className="relative border-b border-[#dce3ed] px-1 py-10 last:border-b-0 md:border-b-0 md:px-8 lg:px-10">
                    <div className="flex items-center justify-between">
                      <span className="grid h-11 w-11 place-items-center rounded-md bg-[#e8efff] text-[#2457f5]"><Icon size={21} /></span>
                      <span className="text-sm font-extrabold text-[#a1aabb]">{step.number}</span>
                    </div>
                    <h3 className="mt-7 text-xl font-extrabold text-[#102544]">{step.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-[#5d6881]">{step.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-y border-[#dce3ed] bg-[#f3f6fa] py-20 sm:py-24">
          <div className="page-container grid items-center gap-12 lg:grid-cols-[0.78fr_1.22fr]">
            <div>
              <p className="eyebrow">Tout au même endroit</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#102544] sm:text-4xl">Un espace qui vous dit quoi faire, et quand.</h2>
              <p className="mt-5 text-base leading-7 text-[#5d6881]">Montant estimé, pièces manquantes, progression du dossier : chaque information utile reste visible sans jargon administratif.</p>
              <ul className="mt-7 grid gap-4 text-sm font-semibold text-[#34415d]">
                {["Suivi de chaque dossier en temps réel", "Pièces demandées uniquement si nécessaire", "Historique clair de vos documents et analyses"].map((item) => (
                  <li key={item} className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-md bg-[#e8f7f0] text-[#16875b]"><Check size={15} strokeWidth={3} /></span>{item}</li>
                ))}
              </ul>
              <a href="/inscription" className="mt-8 inline-flex items-center gap-2 text-sm font-extrabold text-[#2457f5] hover:text-[#1947d8]">Découvrir mon espace <ChevronRight size={17} /></a>
            </div>

            <div className="surface overflow-hidden bg-white shadow-[0_24px_60px_rgba(16,37,68,0.13)]" aria-label="Aperçu du tableau de bord Lydoc">
              <div className="flex h-12 items-center justify-between border-b border-[#dce3ed] px-4">
                <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#e9654b]" /><span className="h-2.5 w-2.5 rounded-full bg-[#e7b84b]" /><span className="h-2.5 w-2.5 rounded-full bg-[#40b883]" /></div>
                <span className="text-[11px] font-bold text-[#8b95a8]">app.lydoc.fr</span>
              </div>
              <div className="grid min-h-[390px] sm:grid-cols-[150px_1fr]">
                <div className="hidden bg-[#102544] p-4 sm:block">
                  <p className="text-xs font-extrabold text-white">Lydoc</p>
                  <div className="mt-7 grid gap-2 text-[10px] font-semibold text-[#b8c5d8]">
                    <span className="rounded bg-white/10 px-2 py-2 text-white">Vue d’ensemble</span>
                    <span className="px-2 py-2">Mes documents</span>
                    <span className="px-2 py-2">Mes dossiers</span>
                    <span className="px-2 py-2">Remboursements</span>
                  </div>
                </div>
                <div className="p-5 sm:p-6">
                  <div className="flex items-end justify-between gap-4">
                    <div><p className="text-xs text-[#7a8499]">Bonjour Jean</p><p className="mt-1 text-lg font-extrabold text-[#102544]">Votre espace</p></div>
                    <span className="rounded-md bg-[#2457f5] px-3 py-2 text-[10px] font-extrabold text-white">+ Déposer</span>
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[["14,85 €", "À récupérer"], ["2", "Dossiers"], ["1", "Envoyé"], ["32,40 €", "Remboursé"]].map(([value, label], index) => (
                      <div key={label} className="rounded-md border border-[#dce3ed] p-3"><p className={`text-base font-extrabold ${index === 3 ? "text-[#16875b]" : "text-[#102544]"}`}>{value}</p><p className="mt-1 text-[10px] text-[#7a8499]">{label}</p></div>
                    ))}
                  </div>
                  <p className="mt-7 text-xs font-extrabold text-[#102544]">Activité récente</p>
                  <div className="mt-3 divide-y divide-[#e6ebf1] border-y border-[#e6ebf1]">
                    {[["Facture Orange analysée", "14,85 € détectés", "Aujourd’hui"], ["Dossier M6 prêt", "Pièces complètes", "Hier"], ["Remboursement reçu", "24,90 €", "28 juin"]].map(([title, info, date]) => (
                      <div key={title} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-[10px]"><div><p className="font-bold text-[#34415d]">{title}</p><p className="mt-1 text-[#7a8499]">{info}</p></div><span className="text-[#9aa3b3]">{date}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#102544] py-20 text-white sm:py-24">
          <div className="page-container grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="eyebrow !text-[#82a3ff]">Vos données restent les vôtres</p>
              <h2 className="mt-3 max-w-xl text-3xl font-extrabold leading-tight sm:text-4xl">Des documents sensibles traités avec le sérieux qu’ils méritent.</h2>
              <p className="mt-5 max-w-xl text-base leading-7 text-[#c2cede]">Les documents sont chiffrés et leur accès est limité à la préparation de votre dossier. Vous gardez le contrôle sur les pièces transmises.</p>
              <a href="/securite" className="mt-8 inline-flex items-center gap-2 text-sm font-extrabold text-white hover:text-[#b8caff]">Découvrir notre approche sécurité <ArrowRight size={17} /></a>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg border border-white/[0.15] bg-white/[0.15] sm:grid-cols-2">
              {[
                [LockKeyhole, "Chiffrement", "Vos fichiers sont chiffrés pendant leur stockage."],
                [ShieldCheck, "Accès contrôlé", "Seules les opérations utiles au dossier sont autorisées."],
                [FileCheck2, "Traçabilité", "Chaque document reste associé au bon dossier."],
                [ReceiptText, "Collecte minimale", "RIB et identité uniquement lorsque le règlement l’exige."],
              ].map(([Icon, title, description]) => {
                const SecurityIcon = Icon as typeof LockKeyhole;
                return <div key={title as string} className="bg-[#102544] p-6"><SecurityIcon size={22} className="text-[#82a3ff]" /><h3 className="mt-5 font-extrabold">{title as string}</h3><p className="mt-2 text-sm leading-6 text-[#b8c5d8]">{description as string}</p></div>;
              })}
            </div>
          </div>
        </section>

        <section id="tarifs" className="scroll-mt-20 bg-white py-20 sm:py-24">
          <div className="page-container grid gap-12 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div className="max-w-xl">
              <p className="eyebrow">Un tarif lisible</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#102544] sm:text-4xl">Vous analysez d’abord. Vous choisissez ensuite.</h2>
              <p className="mt-5 text-base leading-7 text-[#5d6881]">La création du compte et l’analyse de la facture ne vous engagent à rien. Le prix est confirmé avant la préparation et l’envoi du dossier.</p>
            </div>
            <div className="border-l-4 border-[#2457f5] bg-[#f3f6fa] px-6 py-7 sm:px-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div><p className="text-sm font-bold text-[#5d6881]">Analyse de la facture</p><p className="mt-1 text-4xl font-extrabold text-[#102544]">Gratuite</p></div>
                <span className="rounded-md bg-[#e8f7f0] px-3 py-2 text-xs font-extrabold text-[#16875b]">Sans abonnement</span>
              </div>
              <div className="mt-6 border-t border-[#d5dde8] pt-6">
                <p className="text-sm leading-6 text-[#5d6881]">Les frais de préparation du dossier sont affichés clairement avant votre validation. Aucun prélèvement automatique.</p>
                <a href="/inscription" className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-[#2457f5]">Tester gratuitement <ArrowRight size={17} /></a>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[#dce3ed] bg-[#f3f6fa] py-20 sm:py-24">
          <div className="page-container grid gap-12 lg:grid-cols-[0.65fr_1fr]">
            <div>
              <p className="eyebrow">Questions fréquentes</p>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#102544]">Les réponses avant de commencer.</h2>
              <a href="/faq" className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-[#2457f5]">Voir toute la FAQ <ArrowRight size={17} /></a>
            </div>
            <div className="divide-y divide-[#cfd8e4] border-y border-[#cfd8e4]">
              {faqs.map(([question, answer]) => (
                <details key={question} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-extrabold text-[#102544]">
                    {question}<span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-[#2457f5] transition-transform group-open:rotate-90"><ChevronRight size={17} /></span>
                  </summary>
                  <p className="max-w-2xl pb-5 pr-10 text-sm leading-6 text-[#5d6881]">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white py-20 sm:py-24">
          <div className="page-container flex flex-col items-start justify-between gap-8 border-y border-[#dce3ed] py-12 md:flex-row md:items-center">
            <div className="max-w-2xl"><p className="eyebrow">Votre facture peut déjà vous répondre</p><h2 className="mt-3 text-3xl font-extrabold leading-tight text-[#102544]">Découvrez son potentiel de remboursement.</h2><p className="mt-3 text-sm leading-6 text-[#5d6881]">Créez votre compte en quelques instants. RIB et pièce d’identité ne sont pas nécessaires.</p></div>
            <a href="/inscription" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#1947d8]">Analyser ma facture <ArrowRight size={17} /></a>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
