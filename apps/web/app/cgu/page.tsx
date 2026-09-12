import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = {
  title: "Conditions générales d’utilisation",
};

export default function TermsOfUsePage() {
  const sections = [
    {
      id: "objet",
      title: "1. Objet",
      content: (
        <>
          <p>
            Lydoc est un service gratuit d’assistance documentaire destiné aux
            particuliers majeurs résidant en France.
          </p>
          <p>
            Il aide l’utilisateur à déclarer les frais d’une facture opérateur, à rapprocher
            les frais détectés d’un règlement de jeu et à constituer un dossier
            qu’il télécharge, vérifie, imprime et transmet lui-même.
          </p>
        </>
      ),
    },
    {
      id: "compte",
      title: "2. Compte utilisateur",
      content: (
        <>
          <p>
            L’accès à l’analyse nécessite la création d’un compte avec une
            adresse e-mail valide. L’utilisateur protège ses identifiants et
            signale rapidement toute utilisation non autorisée.
          </p>
          <p>
            Les informations communiquées doivent être exactes et à jour. Un
            compte est personnel et ne peut pas être cédé.
          </p>
        </>
      ),
    },
    {
      id: "fonctionnement",
      title: "3. Fonctionnement du service",
      content: (
        <>
          <p>
            L’utilisateur choisit le jeu concerné, dépose sa facture et peut
            corriger le nombre de SMS ou le montant détecté. Les pièces
            complémentaires ne sont demandées que lorsqu’elles figurent dans le
            règlement sélectionné.
          </p>
          <p>
            Le dossier généré doit être relu avant son utilisation. Lydoc
            n’envoie actuellement aucun courrier au nom de l’utilisateur.
          </p>
        </>
      ),
    },
    {
      id: "analyse",
      title: "4. Analyse automatisée",
      content: (
        <>
          <p>
            L’analyse repose en partie sur des outils de reconnaissance
            documentaire. Elle constitue une aide susceptible de comporter des
            erreurs et ne produit aucune décision juridique automatisée.
          </p>
          <p>
            Les factures opérateur peuvent être transmises au prestataire
            d’analyse indiqué dans la politique de confidentialité. Les RIB et
            pièces d’identité ne sont jamais envoyés à une intelligence
            artificielle.
          </p>
        </>
      ),
    },
    {
      id: "utilisateur",
      title: "5. Obligations de l’utilisateur",
      content: (
        <>
          <p>
            L’utilisateur transmet uniquement des documents authentiques lui
            appartenant ou qu’il est autorisé à utiliser. Il lui appartient de
            vérifier les montants, les coordonnées, les délais et les
            justificatifs avant tout envoi.
          </p>
          <p>
            Les faux documents, tentatives de fraude, atteintes au service ou
            usages contraires à la loi peuvent entraîner le blocage du compte et
            la conservation des éléments strictement nécessaires à la défense
            des droits de Lydoc.
          </p>
        </>
      ),
    },
    {
      id: "gratuite",
      title: "6. Gratuité et offre future",
      content: (
        <>
          <p>
            La création du compte, l’analyse, la constitution et le
            téléchargement du dossier sont actuellement gratuits.
          </p>
          <p>
            L’impression et l’envoi postal par Lydoc sont présentés comme une
            fonctionnalité future. Ils ne peuvent pas être commandés et leur
            présentation ne constitue pas une offre contractuelle.
          </p>
        </>
      ),
    },
    {
      id: "responsabilite",
      title: "7. Responsabilité",
      content: (
        <>
          <p>
            Lydoc est tenu à une obligation de moyens pour fournir un dossier
            cohérent à partir des informations disponibles.
          </p>
          <p>
            Lydoc n’est ni l’organisateur du jeu ni l’organisme payeur.
            L’éligibilité définitive, l’acceptation, le délai de traitement et
            le versement relèvent de l’organisateur. Aucun résultat affiché ne
            garantit un remboursement.
          </p>
        </>
      ),
    },
    {
      id: "disponibilite",
      title: "8. Disponibilité et évolution",
      content: (
        <>
          <p>
            Le service peut être interrompu pour maintenance, sécurité ou
            correction. Certaines fonctionnalités peuvent évoluer pendant la
            phase de lancement.
          </p>
          <p>
            Une modification importante des présentes conditions sera portée à
            la connaissance des utilisateurs avant son entrée en vigueur.
          </p>
        </>
      ),
    },
    {
      id: "donnees",
      title: "9. Documents et données personnelles",
      content: (
        <>
          <p>
            Le traitement des données est décrit dans la politique de
            confidentialité. Les documents peuvent être supprimés depuis
            l’espace utilisateur lorsqu’ils ne sont pas verrouillés par un
            dossier finalisé.
          </p>
          <p>
            Une demande d’effacement complémentaire, y compris du compte, peut
            être adressée à rgpd_lydoc@gmail.com. Elle sera traitée sous réserve
            des obligations légales et de la nécessité de protéger les droits
            des parties.
          </p>
        </>
      ),
    },
    {
      id: "propriete",
      title: "10. Propriété intellectuelle",
      content: (
        <p>
          La structure, les textes, l’interface et les éléments propres à Lydoc
          ne peuvent pas être reproduits ou exploités sans autorisation, hors
          exceptions prévues par la loi. Les documents déposés restent la
          propriété de leurs titulaires.
        </p>
      ),
    },
    {
      id: "contact",
      title: "11. Contact et droit applicable",
      content: (
        <>
          <p>
            Toute difficulté peut être signalée à contact.lydoc@gmail.com. Lydoc
            vise une réponse circonstanciée dans un délai maximal de 30 jours.
          </p>
          <p>
            Les présentes conditions sont soumises au droit français, sans
            priver l’utilisateur des protections impératives dont il bénéficie.
          </p>
        </>
      ),
    },
  ];

  return (
    <PublicPage
      eyebrow="Service gratuit"
      title="Conditions générales d’utilisation"
      description="Le cadre du service Lydoc actuellement accessible."
    >
      <LegalDocument
        updatedAt="2 août 2026 - version de pré-lancement"
        sections={sections}
      />
    </PublicPage>
  );
}
