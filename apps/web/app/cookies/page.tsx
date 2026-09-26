import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";
import { CookieSettingsButton } from "../../components/cookie-settings-button";

export const metadata: Metadata = {
  title: "Politique relative aux cookies",
  description:
    "Traceurs nécessaires, mesure d’audience et choix disponibles sur Lydoc.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  const sections = [
    {
      id: "definition",
      title: "1. Qu’est-ce qu’un cookie ?",
      content: (
        <p>
          Un cookie ou traceur est une information enregistrée ou lue sur votre
          terminal lors de l’utilisation d’un site ou d’un service en ligne.
        </p>
      ),
    },
    {
      id: "necessaires",
      title: "2. Traceurs nécessaires",
      content: (
        <>
          <p>
            Lydoc utilise uniquement les mécanismes techniques nécessaires à
            l’authentification, à la sécurité de la session et au fonctionnement
            demandé par l’utilisateur.
          </p>
          <p>
            Ces traceurs ne sont pas utilisés pour établir un profil
            publicitaire et ne nécessitent pas de consentement préalable
            lorsqu’ils sont strictement nécessaires au service.
          </p>
        </>
      ),
    },
    {
      id: "audience",
      title: "3. Mesure d’audience",
      content: (
        <>
          <p>
            Avec votre accord, Google Analytics 4 mesure la fréquentation des
            pages publiques de Lydoc. Aucune balise d’audience n’est chargée
            avant votre acceptation. Les pages du compte, des dossiers et de
            l’administration ne sont pas mesurées.
          </p>
          <p>
            Lydoc transmet à Google la page publique consultée sans les
            paramètres de l’adresse. Ce choix est conservé pendant six mois,
            puis redemandé. Les statistiques servent à comprendre la
            fréquentation du site et ne sont pas rapprochées des dossiers.
          </p>
        </>
      ),
    },
    {
      id: "tiers",
      title: "4. Contenus tiers",
      content: (
        <p>
          Lydoc n’intègre actuellement ni publicité, ni vidéo, ni bouton social
          susceptible de déposer des traceurs tiers sur les pages publiques.
        </p>
      ),
    },
    {
      id: "choix",
      title: "5. Vos choix",
      content: (
        <>
          <p>
            Vous pouvez refuser la mesure d’audience ou retirer votre accord à
            tout moment. Le refus n’empêche pas l’utilisation de Lydoc.
          </p>
          <p><CookieSettingsButton /></p>
          <p>
            Vous pouvez aussi configurer votre navigateur pour supprimer ou
            bloquer les cookies. Le blocage des traceurs indispensables peut
            empêcher la connexion ou certaines fonctionnalités.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      title: "6. Contact",
      content: (
        <p>
          Pour toute question relative aux traceurs ou à vos données, écrivez à
          contact@lydoc.fr.
        </p>
      ),
    },
  ];

  return (
    <PublicPage
      eyebrow="Vos choix"
      title="Politique relative aux cookies"
      description="Les traceurs utilisés aujourd’hui et les règles appliquées avant toute évolution."
    >
      <LegalDocument
        updatedAt="26 septembre 2026"
        sections={sections}
      />
    </PublicPage>
  );
}
