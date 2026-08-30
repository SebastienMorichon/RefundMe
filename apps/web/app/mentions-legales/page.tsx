import type { Metadata } from "next";
import { LegalDocument, PublicPage } from "../../components/public-page";

export const metadata: Metadata = { title: "Mentions légales" };

export default function LegalNoticePage() {
  const sections = [
    {
      id: "statut",
      title: "Statut du site",
      content: (
        <>
          <p>
            Lydoc est actuellement un projet en phase de pré-lancement. Le
            service accessible est gratuit et l’offre d’impression et d’envoi
            postal n’est pas commercialisée.
          </p>
          <p>Site prévu : lydoc.fr. Contact : contact.lydoc@gmail.com.</p>
        </>
      ),
    },
    {
      id: "editeur",
      title: "Éditeur du site",
      content: (
        <>
          <p>Lydoc est actuellement exploité en nom propre par son créateur.</p>
          <p>
            <strong>À compléter avant ouverture publique :</strong> nom, prénom,
            domicile et numéro de téléphone de l’éditeur, ou informations
            d’immatriculation de l’entreprise individuelle si elle est créée.
          </p>
        </>
      ),
    },
    {
      id: "direction",
      title: "Direction de la publication",
      content: (
        <p>
          Le créateur exploitant Lydoc en nom propre assumera la direction de la
          publication. Son identité doit être ajoutée avant l’ouverture
          publique.
        </p>
      ),
    },
    {
      id: "hebergement",
      title: "Hébergement prévu",
      content: (
        <>
          <p>
            OVH SAS, société par actions simplifiée au capital de 50 000 000 €,
            immatriculée au RCS Lille Métropole sous le numéro 424 761 419, 2
            rue Kellermann, 59100 Roubaix, France.
          </p>
          <p>
            Le service et la région d’hébergement effectivement commandés
            devront être vérifiés avant publication.
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
          contact.lydoc@gmail.com.
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
      <LegalDocument
        updatedAt="2 août 2026 - identité de l’éditeur à compléter"
        sections={sections}
      />
    </PublicPage>
  );
}
