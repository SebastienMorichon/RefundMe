import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function PrivacyPage() {
  const sections = [
    {
      id: "responsable",
      title: "1. Responsable du traitement",
      content: (
        <>
          <p>
            Le responsable du traitement est la personne qui exploite Lydoc et
            décide pourquoi et comment les données sont utilisées. Tant
            qu’aucune entreprise n’est créée, cette responsabilité est assumée
            personnellement par le créateur de Lydoc.
          </p>
          <p>
            <strong>À compléter avant ouverture publique :</strong> identité et
            coordonnées postales du responsable. Contact relatif aux données :
            rgpd_lydoc@gmail.com.
          </p>
        </>
      ),
    },
    {
      id: "donnees",
      title: "2. Données traitées",
      content: (
        <>
          <p>
            Lydoc traite les données du compte et du profil, les factures
            opérateur, les choix de jeu, les résultats de détection, les pièces
            nécessaires au dossier, les dossiers générés, les échanges avec le
            support ainsi que les journaux techniques et de sécurité.
          </p>
          <p>
            Le RIB et la pièce d’identité ne sont pas demandés à l’inscription.
            Ils sont collectés uniquement lorsqu’un règlement les exige.
          </p>
        </>
      ),
    },
    {
      id: "finalites",
      title: "3. Finalités et bases légales",
      content: (
        <>
          <p>
            Les données nécessaires à la création du compte, à l’analyse, à la
            préparation du dossier et au support sont traitées pour fournir le
            service demandé et exécuter les conditions d’utilisation.
          </p>
          <p>
            La sécurité, la prévention des abus et la défense des droits de
            Lydoc reposent sur l’intérêt légitime. Les traitements facultatifs
            de mesure d’audience ou de communication commerciale reposeront sur
            le consentement lorsqu’il est requis.
          </p>
        </>
      ),
    },
    {
      id: "ia",
      title: "4. Analyse documentaire et intelligence artificielle",
      content: (
        <>
          <p>
            Les factures opérateur peuvent être transmises à l’API Mistral afin
            d’en extraire le texte utile à la détection des frais. Les
            règlements de jeux importés par un administrateur peuvent également
            être analysés par Mistral.
          </p>
          <p>
            Les RIB et pièces d’identité ne sont jamais transmis à Mistral ni à
            un autre fournisseur d’intelligence artificielle. Lydoc n’utilise
            aucun document client pour entraîner un modèle.
          </p>
          <p>
            Le résultat est une aide que l’utilisateur peut corriger. Aucune
            décision produisant un effet juridique n’est prise exclusivement par
            un traitement automatisé.
          </p>
        </>
      ),
    },
    {
      id: "securite",
      title: "5. Protection des documents sensibles",
      content: (
        <>
          <p>
            Avant leur stockage, les RIB et pièces d’identité reçoivent
            localement un filigrane précisant leur usage limité au dossier de
            remboursement. Tous les documents sont ensuite chiffrés et rattachés
            au compte qui les a déposés.
          </p>
          <p>
            Un document est déchiffré uniquement pour une opération autorisée,
            notamment la génération du dossier demandé par son propriétaire.
            Dans la version gratuite actuelle, ce dossier est remis directement
            à l’utilisateur et n’est transmis à aucun prestataire postal.
          </p>
        </>
      ),
    },
    {
      id: "prestataires",
      title: "6. Destinataires et prestataires",
      content: (
        <>
          <p>
            Les données sont accessibles aux seules personnes et opérations
            nécessaires au fonctionnement de Lydoc.
          </p>
          <p>
            Les catégories de prestataires prévues sont : OVHcloud pour
            l’hébergement de production, Mistral AI pour les factures opérateur
            et règlements, et un prestataire d’envoi d’e-mails transactionnels
            lorsqu’il sera configuré.
          </p>
          <p>
            Stripe et le prestataire postal ne reçoivent actuellement aucune
            donnée, car l’offre payante est désactivée. La liste, la
            localisation et les garanties contractuelles de chaque prestataire
            seront vérifiées avant l’ouverture publique.
          </p>
        </>
      ),
    },
    {
      id: "transferts",
      title: "7. Transferts hors de l’Espace économique européen",
      content: (
        <p>
          Lydoc privilégie un hébergement en France ou dans l’Union européenne.
          Si un prestataire implique un transfert hors de l’Espace économique
          européen, sa base juridique et les garanties applicables seront
          indiquées ici avant son activation.
        </p>
      ),
    },
    {
      id: "duree",
      title: "8. Durées de conservation",
      content: (
        <>
          <p>
            La configuration de pré-lancement limite actuellement la
            conservation opérationnelle des documents à 365 jours, sauf
            suppression anticipée par l’utilisateur. Une demande de suppression
            bénéficie d’un délai technique de sept jours avant purge définitive.
          </p>
          <p>
            Avant l’ouverture publique, une suppression automatique spécifique
            des RIB et pièces d’identité doit être mise en place au plus tard 30
            jours après le premier téléchargement du dossier final. Les journaux
            techniques seront conservés au maximum six mois et les sauvegardes
            supprimées selon un cycle maximal de 30 jours.
          </p>
          <p>
            Le compte est conservé tant qu’il est utilisé. Sa suppression peut
            être demandée par e-mail, sous réserve des données devant
            temporairement être conservées pour respecter une obligation légale
            ou défendre un droit.
          </p>
        </>
      ),
    },
    {
      id: "droits",
      title: "9. Vos droits",
      content: (
        <>
          <p>
            Vous pouvez demander l’accès, la rectification, l’effacement, la
            limitation ou la portabilité de vos données et vous opposer à un
            traitement lorsque la réglementation le permet. Vous pouvez retirer
            votre consentement à tout moment pour les traitements qui reposent
            sur celui-ci.
          </p>
          <p>
            Adressez votre demande à rgpd_lydoc@gmail.com. Une vérification
            proportionnée de votre identité pourra être demandée. Vous pouvez
            également déposer une réclamation auprès de la CNIL.
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      title: "10. Cookies et mesure d’audience",
      content: (
        <p>
          La version actuelle utilise uniquement les mécanismes nécessaires à la
          session et à la sécurité. Aucun outil d’audience non essentiel n’est
          actif. Toute évolution sera décrite dans la politique relative aux
          cookies et soumise au consentement lorsque celui-ci est requis.
        </p>
      ),
    },
    {
      id: "mise-a-jour",
      title: "11. Mise à jour",
      content: (
        <p>
          Cette politique sera révisée lorsque l’hébergement, les sous-traitants
          ou les fonctionnalités évoluent. Une modification importante sera
          signalée aux utilisateurs concernés.
        </p>
      ),
    },
  ];

  return (
    <PublicPage
      eyebrow="Protection des données"
      title="Politique de confidentialité"
      description="Ce que Lydoc utilise, pourquoi et les protections appliquées à vos documents."
    >
      <LegalDocument
        updatedAt="2 août 2026 - version de pré-lancement"
        sections={sections}
      />
    </PublicPage>
  );
}
