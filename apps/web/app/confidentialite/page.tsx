import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description:
    "Données utilisées par Lydoc, finalités, durées de conservation et droits des utilisateurs.",
  alternates: { canonical: "/confidentialite" },
};

export default function PrivacyPage() {
  const sections = [
    {
      id: "responsable",
      title: "1. Responsable du traitement",
      content: (
        <>
          <p>
            Le responsable du traitement est Philippe Joubert, créateur de
            Lydoc, qui décide pourquoi et comment les données sont utilisées.
            Lydoc est le nom du service et non une société.
          </p>
          <p>Contact relatif aux données personnelles : contact@lydoc.fr.</p>
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
      title: "4. Documents et intelligence artificielle",
      content: (
        <>
          <p>
            Les factures opérateur déposées par les utilisateurs ne sont pas
            transmises à Mistral ni à un autre fournisseur d’intelligence
            artificielle. L’utilisateur saisit lui-même le nombre de SMS et le
            montant figurant sur sa facture.
          </p>
          <p>
            Les règlements de jeux importés par un administrateur peuvent être
            analysés par Mistral afin d’en préparer une fiche, qui est ensuite
            vérifiée avant publication. Les RIB, pièces d’identité et autres
            documents clients ne sont jamais transmis à ce fournisseur.
          </p>
          <p>
            Lydoc n’utilise aucun document client pour entraîner un modèle et
            aucune décision produisant un effet juridique n’est prise
            exclusivement par un traitement automatisé.
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
            Avant leur stockage, les documents sont chiffrés et rattachés au
            compte qui les a déposés.
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
            Les catégories de prestataires sont : OVHcloud pour l’hébergement de
            production sur un serveur VPS-2 situé en France, Mistral AI pour les
            règlements de jeux importés par l’administration, le prestataire
            d’envoi d’e-mails transactionnels configuré pour le service et,
            uniquement après consentement, Google pour la mesure d’audience des
            pages publiques.
          </p>
          <p>
            SumUp et le prestataire postal ne reçoivent actuellement aucune
            donnée, car l’offre payante est désactivée. Les garanties
            contractuelles et les éventuels transferts de chaque prestataire
            doivent être suivis pendant toute leur utilisation.
          </p>
        </>
      ),
    },
    {
      id: "transferts",
      title: "7. Transferts hors de l’Espace économique européen",
      content: (
        <p>
          Le serveur VPS-2 utilisé pour Lydoc et ses données applicatives sont
          hébergés par OVHcloud en France. Si vous acceptez la mesure d’audience,
          des données de navigation sur les pages publiques sont transmises à
          Google. Ce traitement peut impliquer un transfert hors de l’Espace
          économique européen, selon les conditions de Google.
        </p>
      ),
    },
    {
      id: "duree",
      title: "8. Durées de conservation",
      content: (
        <>
          <p>
            Les documents nécessaires à un dossier sont conservés jusqu’à son
            téléchargement. Une fois le téléchargement terminé, les pièces et la
            copie serveur du dossier sont automatiquement mises en purge.
          </p>
          <p>
            Les journaux techniques sont conservés au maximum six mois et les
            sauvegardes supprimées selon un cycle maximal de 30 jours. Ils ne
            contiennent pas le contenu des pièces déposées.
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
            Adressez votre demande à contact@lydoc.fr. Une vérification
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
          La session et la sécurité utilisent des mécanismes nécessaires au
          service. Google Analytics 4 n’est chargé que si vous acceptez la mesure
          d’audience. Cette mesure concerne les pages publiques uniquement et
          peut être refusée ou retirée depuis la politique relative aux cookies.
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
      <LegalDocument updatedAt="26 septembre 2026" sections={sections} />
    </PublicPage>
  );
}
