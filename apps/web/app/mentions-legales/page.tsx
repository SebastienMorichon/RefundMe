import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = {
  title: "Mentions légales",
  description:
    "Informations sur l’éditeur, l’hébergement et la responsabilité du site Lydoc.",
  alternates: { canonical: "/mentions-legales" },
};

export default function LegalNoticePage() {
  const sections = [
    {
      id: "statut",
      title: "Statut du site",
      content: (
        <>
          <p>
            Lydoc est le nom du service proposé sur lydoc.fr. Le service est
            gratuit. À ce jour, il n’est exploité ni par une société ni par une
            entreprise immatriculée et ne dispose donc pas de numéro SIREN.
          </p>
          <p>Site : lydoc.fr. Contact : contact@lydoc.fr.</p>
        </>
      ),
    },
    {
      id: "editeur",
      title: "Éditeur du site",
      content: (
        <>
          <p>
            Le site est édité à titre non professionnel par une personne
            physique, créatrice de Lydoc, qui a choisi de préserver son
            anonymat.
          </p>
          <p>
            Son identité complète a été communiquée à l’hébergeur conformément à
            l’article 1-1, II, de la loi n° 2004-575 du 21 juin 2004 pour la
            confiance dans l’économie numérique.
          </p>
        </>
      ),
    },
    {
      id: "direction",
      title: "Direction de la publication",
      content: (
        <p>
          La direction de la publication est assurée par le créateur de Lydoc.
          Son identité n’est pas rendue publique au titre du régime applicable à
          l’éditeur non professionnel décrit ci-dessus.
        </p>
      ),
    },
    {
      id: "hebergement",
      title: "Hébergement",
      content: (
        <>
          <p>
            OVH SAS, société par actions simplifiée au capital de 50 000 000 €,
            immatriculée au RCS Lille Métropole sous le numéro 424 761 419, 2
            rue Kellermann, 59100 Roubaix, France.
          </p>
          <p>
            Lydoc utilise un serveur VPS-2 OVHcloud situé en France. Les données
            applicatives hébergées par ce serveur sont conservées en France, au
            sein de l’Union européenne.
          </p>
        </>
      ),
    },
    {
      id: "propriete",
      title: "Propriété intellectuelle",
      content: (
        <p>
          La structure, les textes, l’interface et les éléments graphiques
          propres à Lydoc sont protégés. Toute reproduction non autorisée est
          interdite, sous réserve des exceptions prévues par la loi.
        </p>
      ),
    },
    {
      id: "responsabilite",
      title: "Nature des informations",
      content: (
        <p>
          Lydoc fournit une assistance documentaire. Les informations et
          estimations affichées ne constituent ni un conseil juridique
          individualisé ni une garantie de remboursement.
        </p>
      ),
    },
    {
      id: "signalement",
      title: "Contact et signalement",
      content: (
        <p>
          Pour signaler un contenu ou poser une question sur le site, écrivez à
          contact@lydoc.fr.
        </p>
      ),
    },
  ];

  return (
    <PublicPage
      eyebrow="Informations légales"
      title="Mentions légales"
      description="Les informations relatives à l’éditeur et à l’hébergement de Lydoc."
    >
      <LegalDocument updatedAt="13 septembre 2026" sections={sections} />
    </PublicPage>
  );
}
