import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Politique relative aux cookies" };

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
            Aucun outil de mesure d’audience non essentiel n’est actuellement
            activé.
          </p>
          <p>
            Si un tel outil est ajouté, Lydoc recueillera le consentement avant
            son activation, sauf configuration répondant strictement aux
            critères d’exemption définis par la CNIL. La présente page et
            l’interface de choix seront alors mises à jour.
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
        <p>
          Vous pouvez configurer votre navigateur pour supprimer ou bloquer les
          cookies. Le blocage des traceurs indispensables peut toutefois
          empêcher la connexion ou le fonctionnement de certaines
          fonctionnalités.
        </p>
      ),
    },
    {
      id: "contact",
      title: "6. Contact",
      content: (
        <p>
          Pour toute question relative aux traceurs ou à vos données, écrivez à
          rgpd_lydoc@gmail.com.
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
        updatedAt="2 août 2026 - version de pré-lancement"
        sections={sections}
      />
    </PublicPage>
  );
}
