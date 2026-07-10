import { Button } from "@lydoc/ui";

const trustItems = [
  "Hebergement France",
  "Donnees chiffrees",
  "Aucun abonnement",
  "Paiement a l'envoi",
];

const workflow = [
  "Compte",
  "Document",
  "Analyse",
  "Pieces utiles",
  "Paiement",
  "Dossier conforme",
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f8faff]">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-6">
        <nav className="flex items-center justify-between">
          <div className="text-base font-bold text-[#080d2b]">Lydoc</div>
          <div className="hidden items-center gap-6 text-sm font-medium text-[#303858] md:flex">
            <a href="#fonctionnement">Fonctionnement</a>
            <a href="#securite">Securite</a>
            <a href="#tarifs">Tarifs</a>
          </div>
          <a href="/dashboard">
            <Button>Creer un compte</Button>
          </a>
        </nav>

        <div className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="mb-4 text-sm font-semibold text-[#5147f5]">Assistant documentaire</p>
            <h1 className="max-w-2xl text-5xl font-bold leading-tight text-[#080d2b]">
              Deposez un document. Lydoc prepare le dossier conforme.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#52607a]">
              Lydoc comprend vos documents, identifie les demarches possibles et vous demande
              uniquement les pieces necessaires au bon moment.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/dashboard">
                <Button>Essayer gratuitement</Button>
              </a>
              <Button variant="secondary">Voir le parcours</Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-4 text-sm text-[#52607a]">
              {trustItems.map((item) => (
                <span key={item}>OK {item}</span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#dfe5f4] bg-white p-6 shadow-[0_24px_70px_rgba(47,67,120,0.14)]">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#52607a]">Facture Orange</p>
                <p className="text-xs text-[#7b86a1]">Analyse terminee</p>
              </div>
              <span className="rounded-full bg-[#e9fbf0] px-3 py-1 text-xs font-semibold text-[#087f3f]">
                Conforme
              </span>
            </div>
            <div className="rounded-md border border-[#e6eaf3] p-5">
              <p className="text-sm text-[#52607a]">Montant estimatif recuperable</p>
              <p className="mt-2 text-4xl font-bold text-[#080d2b]">14,85 EUR</p>
              <p className="mt-4 text-sm leading-6 text-[#52607a]">
                Deux participations detectees. Le dossier peut etre prepare selon le reglement
                valide par l'equipe Lydoc.
              </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-[#e6eaf3] p-4">
                <p className="font-semibold text-[#080d2b]">Pieces demandees apres decision</p>
                <p className="mt-2 text-[#52607a]">RIB et copie d'identite filigranee</p>
              </div>
              <div className="rounded-md border border-[#e6eaf3] p-4">
                <p className="font-semibold text-[#080d2b]">Prix fixe</p>
                <p className="mt-2 text-[#52607a]">2,99 EUR a l'envoi du dossier</p>
              </div>
            </div>
          </div>
        </div>

        <ol className="grid gap-3 pb-2 text-xs font-semibold text-[#52607a] sm:grid-cols-3 lg:grid-cols-6">
          {workflow.map((step, index) => (
            <li key={step} className="rounded-md border border-[#dfe5f4] bg-white px-4 py-3">
              {index + 1}. {step}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
