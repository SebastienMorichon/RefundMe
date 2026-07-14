import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Questions fréquentes" };

const groups = [
  {
    title: "Premiers pas",
    questions: [
      ["À quoi sert Lydoc ?", "Lydoc analyse vos factures, recherche les conditions de remboursement applicables et vous aide à constituer le dossier demandé par l’organisateur."],
      ["Quels documents puis-je analyser ?", "La première version se concentre sur les factures opérateurs liées à des jeux et émissions. D’autres catégories seront ajoutées progressivement."],
      ["Puis-je tester le service sans payer ?", "Oui. La création du compte et l’analyse initiale de la facture sont gratuites. Le tarif est affiché avant toute préparation payante."],
    ],
  },
  {
    title: "Documents et données",
    questions: [
      ["Dois-je fournir un RIB ou une pièce d’identité à l’inscription ?", "Non. Ces documents ne sont pas nécessaires pour créer un compte ou analyser une facture. Ils sont demandés plus tard uniquement lorsque le règlement du dossier l’exige."],
      ["Quels formats sont acceptés ?", "Vous pouvez déposer un PDF ou une image JPG/PNG de 20 Mo maximum. Pour une meilleure analyse, le document doit être lisible et complet."],
      ["Comment mes documents sont-ils protégés ?", "Les fichiers sont chiffrés lors de leur stockage et associés à votre compte. Notre principe est de ne collecter que les pièces nécessaires au traitement du dossier."],
    ],
  },
  {
    title: "Remboursement et paiement",
    questions: [
      ["Le montant affiché est-il garanti ?", "Non. Il s’agit d’une estimation fondée sur la facture et le règlement identifié. La décision finale de remboursement appartient toujours à l’organisateur."],
      ["Quand dois-je payer ?", "Le prix du service est présenté avant la validation du dossier. Il n’y a pas d’abonnement ni de prélèvement automatique récurrent."],
      ["Combien de temps prend un remboursement ?", "Le délai dépend de l’organisateur et des conditions du règlement. Votre espace Lydoc vous permet de suivre l’état du dossier et les actions restantes."],
    ],
  },
];

export default function FaqPage() {
  return (
    <PublicPage eyebrow="Centre d’aide" title="Tout ce qu’il faut savoir avant de commencer." description="Des réponses simples sur l’analyse, les documents demandés et la préparation de votre dossier.">
      <section className="page-container py-14 sm:py-20">
        <div className="grid gap-14">
          {groups.map((group) => (
            <section key={group.title} className="grid gap-7 lg:grid-cols-[240px_1fr]">
              <h2 className="text-xl font-extrabold text-[#102544]">{group.title}</h2>
              <div className="divide-y divide-[#d5dde8] border-y border-[#d5dde8]">
                {group.questions.map(([question, answer]) => (
                  <details key={question} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-extrabold text-[#26334f]">
                      {question}<ChevronRight size={18} className="shrink-0 text-[#2457f5] transition-transform group-open:rotate-90" />
                    </summary>
                    <p className="max-w-2xl pb-6 pr-10 text-sm leading-7 text-[#5d6881]">{answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-16 flex flex-col justify-between gap-5 border-t border-[#dce3ed] pt-10 sm:flex-row sm:items-center"><div><h2 className="text-xl font-extrabold text-[#102544]">Une question reste sans réponse ?</h2><p className="mt-2 text-sm text-[#5d6881]">Notre équipe vous répondra avec plaisir.</p></div><a href="/contact" className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#2457f5] px-5 text-sm font-extrabold text-white">Nous contacter</a></div>
      </section>
    </PublicPage>
  );
}
